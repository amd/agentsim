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
  type DataSource,
} from "../data/api.js";
import { notifyFailure, notifySuccess } from "./Notifications.js";

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
function sourceRow(src: DataSource, refresh: () => void): HTMLElement {
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
function detectedRow(fw: DataSource, refresh: () => void): HTMLElement {
  const add = el("button", { class: "lm-btn lm-btn-secondary", text: "Add", title: `Add ${fw.name}` });
  add.addEventListener("click", async () => {
    add.disabled = true;
    try {
      // A detected source lives at its default location: watch it so new
      // sessions written there show up automatically.
      await addSource(fw.alias, fw.path, true);
      notifyChanged();
      refresh();
    } catch {
      add.disabled = false;
    }
  });

  const meta = [fw.path, `${fw.session_count} sessions`].filter(Boolean).join("  ·  ");

  return el("div", { class: "ds-row" }, [
    el("div", { class: "ds-row-text" }, [
      el("div", { class: "ds-row-name" }, [frameworkTag(fw.name, fw.primary_color)]),
      el("div", { class: "ds-row-meta", text: meta }),
    ]),
    add,
  ]);
}

// Popup window for one import unit — a single path, or several files that share
// a parent folder and become one source. "Select the framework:" over a list of
// the available frameworks; clicking one validates the framework against the
// unit and, if valid, adds every path in it (files sharing a parent merge into
// one source server-side) and closes. An invalid choice shows an inline error
// and leaves the popup open so the user can try another framework or cancel.
// This is the single "pick framework → validate → add or discard" gate shared by
// the Import buttons and drag-drop. Resolves once the popup closes (either way).
function openFrameworkPicker(paths: string[]): Promise<void> {
  return new Promise((resolve) => {
    const label = paths.length === 1 ? paths[0] : `${paths.length} files`;
    const message = el("div", { class: "ds-add-msg" });
    const options = el("div", { class: "ds-picker-options" });

    const closeBtn = el("button", {
      class: "lm-icon-btn ds-close", "aria-label": "Close", text: "✕",
    });

    const modal = el("div", { class: "ds-picker" }, [
      el("div", { class: "ds-header" }, [
        el("h3", { class: "ds-title", text: "Select the framework:" }),
        closeBtn,
      ]),
      el("div", { class: "ds-picker-body" }, [
        el("div", { class: "ds-row-meta ds-picker-path", text: label, title: paths.join("\n") }),
        options,
        message,
      ]),
    ]);

    const overlay = el("div", { class: "ds-overlay" }, [modal]);

    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    const choose = async (alias: string): Promise<void> => {
      options.querySelectorAll("button").forEach((b) => (b.disabled = true));
      message.classList.remove("error");
      message.textContent = "Verifying…";
      try {
        const result = await validateSource(alias, paths[0]);
        if (!result.valid) {
          message.classList.add("error");
          message.textContent = result.error || "Not a valid data source.";
          options.querySelectorAll("button").forEach((b) => (b.disabled = false));
          return;
        }
        // Add each path as a manual (snapshot) source. Files sharing a parent
        // merge into one source; a 409 means that file was already tracked.
        for (const p of paths) {
          try {
            await addSource(alias, p, false);
          } catch (e) {
            if ((e as { status?: number }).status !== 409) throw e;
          }
        }
        notifyChanged();
        activeRefresh?.();
        close();
      } catch (e) {
        message.classList.add("error");
        message.textContent = e instanceof Error ? e.message : "Failed to add data source.";
        options.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    };

    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);

    document.body.append(overlay);

    // Populate the option list from the catalog. Loading/failure states stay
    // inside the popup so the flow is self-contained.
    message.textContent = "Loading frameworks…";
    fetchAvailableFrameworks()
      .then((frameworks) => {
        message.textContent = "";
        for (const fw of frameworks) {
          const btn = el("button", { class: "ds-picker-option" }, [
            frameworkTag(fw.name, fw.primary_color),
          ]);
          btn.addEventListener("click", () => void choose(fw.alias));
          options.append(btn);
        }
      })
      .catch((error) => {
        message.classList.add("error");
        message.textContent = "Cannot reach server.";
        notifyFailure(error, "GET /frameworks/available");
      });
  });
}

// Refresh handle for the open modal's active list, so an add via the framework
// picker updates the list without a full reopen. Null when no modal is mounted.
let activeRefresh: (() => void) | null = null;

// Split a path into its parent directory, handling both separators (dropped
// paths are OS-native, so Windows uses "\").
function parentDir(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut >= 0 ? path.slice(0, cut) : "";
}

// Tauri's drop payload gives paths without types; a trailing trace-file
// extension is the reliable signal for "file" vs "folder" here.
function looksLikeFile(path: string): boolean {
  return /\.(jsonl|json|db)$/i.test(path);
}

// Group dropped/browsed paths into import units, then run each through the
// framework picker. A folder is its own unit (snapshotted whole). Files are
// grouped by parent folder so files from one folder merge into a single source,
// while files from different folders become separate sources.
export function handleDroppedPaths(paths: string[]): void {
  void (async () => {
    const unique = [...new Set(paths)];
    const folders = unique.filter((p) => !looksLikeFile(p));
    const filesByParent = new Map<string, string[]>();
    for (const p of unique.filter(looksLikeFile)) {
      const parent = parentDir(p);
      (filesByParent.get(parent) ?? filesByParent.set(parent, []).get(parent)!).push(p);
    }

    const units: string[][] = [
      ...folders.map((f) => [f]),
      ...filesByParent.values(),
    ];
    for (const unit of units) {
      await openFrameworkPicker(unit);
    }
  })();
}

// Open the modal. Appends an overlay to <body>; closes on the × button, a click
// on the backdrop, or Escape.
export function openDataSourcesModal(): void {
  const mainBody = el("div", { class: "ds-body" });

  const render = async (): Promise<void> => {
    clear(mainBody);
    mainBody.append(el("div", { class: "ds-status", text: "Loading…" }));
    try {
      const [sources, detected] = await Promise.all([
        fetchSources(),
        fetchDetectedFrameworks(),
      ]);

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
          if (picked) handleDroppedPaths([picked]);
        });
        importFolder.addEventListener("click", async () => {
          const picked = await pickPath(true);
          if (picked) handleDroppedPaths([picked]);
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
      notifySuccess("GET /sources");
    } catch (error) {
      clear(mainBody);
      mainBody.append(el("div", { class: "ds-status", text: "Cannot reach server." }));
      notifyFailure(error, "GET /sources");
    }
  };

  const closeBtn = el("button", { class: "lm-icon-btn ds-close", "aria-label": "Close", text: "✕" });

  const modal = el("div", { class: "ds-modal" }, [
    el("div", { class: "ds-header" }, [
      el("h3", { class: "ds-title", text: "Manage Data Sources" }),
      closeBtn,
    ]),
    mainBody,
  ]);

  const overlay = el("div", { class: "ds-overlay" }, [modal]);

  activeRefresh = () => void render();

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    activeRefresh = null;
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
