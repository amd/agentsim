// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

import { invoke } from "@tauri-apps/api/core";
import { el, clear } from "./dom.js";
import {
  addSource,
  fetchAvailableFrameworks,
  fetchDetectedFrameworks,
  fetchSources,
  removeSource,
  validateSource,
  type FrameworkInfo,
  type SourceInfo,
} from "../data/api.js";

// Tell the rest of the app the active set changed so dependent views (e.g. the
// sidebar's session list) re-fetch instead of showing stale data.
function notifyChanged(): void {
  window.dispatchEvent(new CustomEvent("frameworks:changed"));
}

// Native path pickers via the Tauri dialog plugin. Return the chosen path, or
// null when cancelled or when running in the browser (no host). A folder and a
// file both become a "source path" — the framework picker + validator handle the
// rest, so the two dialogs feed one flow.
async function pickPath(directory: boolean): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    const result = await invoke<string | string[] | null>("plugin:dialog|open", {
      options: {
        directory,
        multiple: false,
        title: directory ? "Select data folder" : "Select trace file",
        filters: directory
          ? undefined
          : [{ name: "Trace files", extensions: ["jsonl", "json", "db"] }],
      },
    });
    return typeof result === "string" ? result : null;
  } catch (err) {
    console.error("[data-sources] path pick failed", err);
    return null;
  }
}

// A small colored chip identifying the framework — mirrors the sidebar's
// framework tag (.lm-tag tinted with the backend's brand color), so color is
// confined to a tag instead of washing the whole row.
function frameworkTag(name: string, color: string): HTMLElement {
  const tag = el("span", { class: "lm-tag", text: name });
  if (color) tag.style.color = color;
  return tag;
}

// Render one active source row: framework tag + path/session-count meta, with a
// Remove button that drops it server-side (the file/folder on disk is untouched)
// then refreshes the list.
function sourceRow(src: SourceInfo, refresh: () => void): HTMLElement {
  const meta = [src.path, `${src.session_count} sessions`].filter(Boolean).join("  ·  ");

  const del = el("button", {
    class: "lm-btn lm-btn-danger",
    text: "Remove",
    title: `Remove ${src.name}`,
  });
  del.addEventListener("click", async () => {
    del.disabled = true;
    try {
      await removeSource(src.id);
      notifyChanged();
      refresh();
    } catch {
      del.disabled = false;
    }
  });

  return el("div", { class: "ds-row" }, [
    el("div", { class: "ds-row-text" }, [
      el("div", { class: "ds-row-name" }, [frameworkTag(src.name, src.primary_color)]),
      el("div", { class: "ds-row-meta", text: meta }),
    ]),
    del,
  ]);
}

// Render one auto-detected framework: its name + discovered path, with a
// one-click Add that activates it at that default location.
function detectedRow(fw: FrameworkInfo, refresh: () => void): HTMLElement {
  const add = el("button", { class: "lm-btn lm-btn-secondary", text: "Add", title: `Add ${fw.name}` });
  add.addEventListener("click", async () => {
    add.disabled = true;
    try {
      await addSource(fw.alias, fw.data_basepath);
      notifyChanged();
      refresh();
    } catch {
      add.disabled = false;
    }
  });

  const meta = [fw.data_basepath, `${fw.session_count} sessions`].filter(Boolean).join("  ·  ");

  return el("div", { class: "ds-row" }, [
    el("div", { class: "ds-row-text" }, [
      el("div", { class: "ds-row-name" }, [frameworkTag(fw.name, fw.primary_color)]),
      el("div", { class: "ds-row-meta", text: meta }),
    ]),
    add,
  ]);
}

// A picker row for one staged path (from Browse or drag-drop): the path plus a
// framework dropdown and Add/Cancel. Add validates the chosen framework against
// the path; invalid keeps the row open (the user can switch framework), valid
// adds the source and removes the row. This is the single "pick framework →
// validate → add or discard" gate shared by browsing and dropping.
function stagingRow(
  path: string,
  frameworks: FrameworkInfo[],
  onAdded: () => void,
  onDone: (row: HTMLElement) => void,
): HTMLElement {
  const select = el("select", { class: "lm-select" },
    frameworks.map((f) => el("option", { value: f.alias, text: f.name })),
  ) as HTMLSelectElement;

  const add = el("button", { class: "lm-btn lm-btn-secondary", text: "Add" });
  const cancel = el("button", { class: "lm-btn lm-btn-secondary", text: "Cancel" });
  const message = el("div", { class: "ds-add-msg" });

  const row = el("div", { class: "ds-stage" }, [
    el("div", { class: "ds-row-meta ds-stage-path", text: path, title: path }),
    el("div", { class: "ds-add-row" }, [select, add, cancel]),
    message,
  ]);

  cancel.addEventListener("click", () => onDone(row));

  add.addEventListener("click", async () => {
    add.disabled = true;
    message.classList.remove("error");
    message.textContent = "Verifying…";
    try {
      const result = await validateSource(select.value, path);
      if (!result.valid) {
        message.classList.add("error");
        message.textContent = result.error || "Not a valid data source.";
        add.disabled = false;
        return;
      }
      await addSource(select.value, path);
      notifyChanged();
      onAdded();
      onDone(row);
    } catch (e) {
      message.classList.add("error");
      message.textContent = e instanceof Error ? e.message : "Failed to add data source.";
      add.disabled = false;
    }
  });

  return row;
}

// Handle to the open modal's staging entry point, so a window drop can reach it
// even when the modal was already open. Null when no modal is mounted.
let activeStage: ((paths: string[]) => void) | null = null;

// Stage one or more dropped/browsed paths for the "pick framework → validate →
// add" flow, opening the modal first if it isn't already up. Called by the
// window-wide drag-drop handler and by the Browse buttons.
export function handleDroppedPaths(paths: string[]): void {
  if (paths.length === 0) return;
  if (!activeStage) openDataSourcesModal();
  activeStage?.(paths);
}

// Open the modal. Appends an overlay to <body>; closes on the × button, a click
// on the backdrop, or Escape.
export function openDataSourcesModal(): void {
  // Persisted across re-renders: staged picker rows live here so a mid-flow
  // refresh of the active list doesn't wipe pending pickers.
  const stageArea = el("div", { class: "ds-stage-area" });
  const mainBody = el("div", { class: "ds-body" });

  let available: FrameworkInfo[] = [];

  const stagePaths = (paths: string[]): void => {
    for (const path of paths) {
      // Skip a path already staged (avoid duplicate pickers for the same drop).
      const existing = Array.from(stageArea.querySelectorAll<HTMLElement>(".ds-stage-path"))
        .some((n) => n.textContent === path);
      if (existing) continue;
      const row = stagingRow(
        path,
        available,
        () => void render(),
        (r) => r.remove(),
      );
      stageArea.append(row);
    }
  };
  activeStage = stagePaths;

  const render = async (): Promise<void> => {
    clear(mainBody);
    mainBody.append(el("div", { class: "ds-status", text: "Loading…" }));
    try {
      const [sources, avail, detected] = await Promise.all([
        fetchSources(),
        fetchAvailableFrameworks(),
        fetchDetectedFrameworks(),
      ]);
      available = avail;

      clear(mainBody);

      // Active sources
      const activeBody = sources.length === 0
        ? el("div", { class: "ds-status", text: "No active data sources." })
        : el("div", { class: "ds-list" }, sources.map((s) => sourceRow(s, () => void render())));
      mainBody.append(activeBody);

      mainBody.append(el("div", { class: "ds-divider" }));

      // Detected (one-click add at the default location)
      const detectedBody = detected.length === 0
        ? el("div", { class: "ds-add-empty", text: "No data sources detected." })
        : el("div", { class: "ds-list" }, detected.map((f) => detectedRow(f, () => void render())));

      // Add manually: browse a file or a folder, then pick the framework.
      const addControls: HTMLElement[] = [];
      if ("__TAURI_INTERNALS__" in window) {
        const importFile = el("button", { class: "lm-btn lm-btn-secondary", text: "Import File…" });
        const importFolder = el("button", { class: "lm-btn lm-btn-secondary", text: "Import Folder…" });
        importFile.addEventListener("click", async () => {
          const picked = await pickPath(false);
          if (picked) stagePaths([picked]);
        });
        importFolder.addEventListener("click", async () => {
          const picked = await pickPath(true);
          if (picked) stagePaths([picked]);
        });
        addControls.push(el("div", { class: "ds-add-row" }, [importFile, importFolder]));
      } else {
        addControls.push(el("div", { class: "ds-add-empty", text: "Run the desktop app to add data sources." }));
      }

      mainBody.append(
        el("div", { class: "ds-group" }, [
          el("div", { class: "ds-subsection-title", text: "Detected" }),
          detectedBody,
        ]),
        el("div", { class: "ds-group" }, [
          el("div", { class: "ds-subsection-title", text: "Add data source" }),
          el("div", { class: "ds-hint", text: "Drag a file or folder anywhere, or:" }),
          ...addControls,
        ]),
      );
    } catch {
      clear(mainBody);
      mainBody.append(el("div", { class: "ds-status", text: "Cannot reach server." }));
    }
  };

  const closeBtn = el("button", { class: "lm-icon-btn ds-close", "aria-label": "Close", text: "✕" });

  const modal = el("div", { class: "ds-modal" }, [
    el("div", { class: "ds-header" }, [
      el("h3", { class: "ds-title", text: "Manage Data Sources" }),
      closeBtn,
    ]),
    stageArea,
    mainBody,
  ]);

  const overlay = el("div", { class: "ds-overlay" }, [modal]);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    activeStage = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  document.body.append(overlay);
  void render();
}
