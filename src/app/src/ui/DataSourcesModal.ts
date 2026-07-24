// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

import { invoke } from "@tauri-apps/api/core";
import { el, clear } from "./dom.js";
import {
  addFramework,
  fetchAvailableFrameworks,
  fetchDetectedFrameworks,
  fetchFrameworks,
  removeFramework,
  validateFramework,
  type FrameworkInfo,
} from "../data/api.js";

// Tell the rest of the app the active set changed so dependent views (e.g. the
// sidebar's session list) re-fetch instead of showing stale data.
function notifyChanged(): void {
  window.dispatchEvent(new CustomEvent("frameworks:changed"));
}

// Native folder picker via the Tauri dialog plugin. Returns the chosen path, or
// null when cancelled or when running in the browser (no host) — callers then
// fall back to the typed path field.
async function pickFolder(): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    const result = await invoke<string | string[] | null>("plugin:dialog|open", {
      options: { directory: true, multiple: false, title: "Select data folder" },
    });
    return typeof result === "string" ? result : null;
  } catch (err) {
    console.error("[data-sources] folder pick failed", err);
    return null;
  }
}

// A small colored chip identifying the framework — mirrors the sidebar's
// framework tag (.lm-tag tinted with the backend's brand color), so color is
// confined to a tag instead of washing the whole row.
function frameworkTag(fw: FrameworkInfo): HTMLElement {
  const tag = el("span", { class: "lm-tag", text: fw.name });
  if (fw.primary_color) tag.style.color = fw.primary_color;
  return tag;
}

// Manage Data Sources: a modal over the app that lists the active frameworks
// (the backend's active set) and lets the user add or remove them. The backend
// owns the data; this view fetches on open and re-fetches after every mutation,
// so what's shown always reflects the server.

// Render one active-framework row: name + basepath/session-count meta, with a
// delete button that removes it server-side then refreshes the list.
function frameworkRow(fw: FrameworkInfo, refresh: () => void): HTMLElement {
  const meta = [fw.data_basepath, `${fw.session_count} sessions`]
    .filter(Boolean)
    .join("  ·  ");

  const del = el("button", {
    class: "lm-btn lm-btn-danger",
    text: "Remove",
    title: `Remove ${fw.name}`,
  });
  del.addEventListener("click", async () => {
    del.disabled = true;
    try {
      await removeFramework(fw.alias);
      notifyChanged();
      refresh();
    } catch {
      del.disabled = false;
    }
  });

  const row = el("div", { class: "ds-row" }, [
    el("div", { class: "ds-row-text" }, [
      el("div", { class: "ds-row-name" }, [frameworkTag(fw)]),
      el("div", { class: "ds-row-meta", text: meta }),
    ]),
    del,
  ]);
  return row;
}

// Render one auto-detected framework: its name + discovered path, with a
// one-click Add that activates it at that default location.
function detectedRow(fw: FrameworkInfo, refresh: () => void): HTMLElement {
  const add = el("button", { class: "lm-btn lm-btn-secondary", text: "Add", title: `Add ${fw.name}` });
  add.addEventListener("click", async () => {
    add.disabled = true;
    try {
      await addFramework(fw.alias, fw.data_basepath);
      notifyChanged();
      refresh();
    } catch {
      add.disabled = false;
    }
  });

  const meta = [fw.data_basepath, `${fw.session_count} sessions`]
    .filter(Boolean)
    .join("  ·  ");

  const row = el("div", { class: "ds-row" }, [
    el("div", { class: "ds-row-text" }, [
      el("div", { class: "ds-row-name" }, [frameworkTag(fw)]),
      el("div", { class: "ds-row-meta", text: meta }),
    ]),
    add,
  ]);
  return row;
}

// Build the manual "add a data source" control: a picker of catalog frameworks
// not yet active, a data-path field with a native folder picker, and an Add
// button that verifies the path holds real sessions before activating it.
function manualControl(inactive: FrameworkInfo[], refresh: () => void): HTMLElement {
  if (inactive.length === 0) {
    return el("div", { class: "ds-add-empty", text: "All available data sources are active." });
  }

  const select = el("select", { class: "lm-select" },
    inactive.map((f) => el("option", { value: f.alias, text: f.name })),
  ) as HTMLSelectElement;
  const path = el("input", {
    class: "lm-input",
    type: "text",
    placeholder: "Data path (required)",
  }) as HTMLInputElement;
  const add = el("button", { class: "lm-btn lm-btn-secondary", text: "Add" });
  const message = el("div", { class: "ds-add-msg" });

  const pathRow: HTMLElement[] = [path];
  if ("__TAURI_INTERNALS__" in window) {
    const browse = el("button", { class: "lm-btn lm-btn-secondary", text: "Browse…" });
    browse.addEventListener("click", async () => {
      const picked = await pickFolder();
      if (picked) path.value = picked;
    });
    pathRow.push(browse);
  }

  add.addEventListener("click", async () => {
    const p = path.value.trim();
    if (!p) {
      message.classList.add("error");
      message.textContent = "Data path is required.";
      return;
    }
    add.disabled = true;
    message.classList.remove("error");
    message.textContent = "Verifying…";
    try {
      const result = await validateFramework(select.value, p);
      if (!result.valid) {
        message.classList.add("error");
        message.textContent = result.error || "Not a valid data source.";
        add.disabled = false;
        return;
      }
      await addFramework(select.value, p);
      notifyChanged();
      refresh();
    } catch (e) {
      message.classList.add("error");
      message.textContent = e instanceof Error ? e.message : "Failed to add data source.";
      add.disabled = false;
    }
  });

  return el("div", { class: "ds-add" }, [
    el("div", { class: "ds-add-row" }, [select, ...pathRow, add]),
    message,
  ]);
}

// Open the modal. Appends an overlay to <body>; closes on the × button, a click
// on the backdrop, or Escape.
export function openDataSourcesModal(): void {
  const body = el("div", { class: "ds-body" });

  const render = async (): Promise<void> => {
    clear(body);
    body.append(el("div", { class: "ds-status", text: "Loading…" }));
    try {
      const [active, available, detected] = await Promise.all([
        fetchFrameworks(),
        fetchAvailableFrameworks(),
        fetchDetectedFrameworks(),
      ]);
      const activeAliases = new Set(active.map((f) => f.alias));
      const inactive = available.filter((f) => !activeAliases.has(f.alias));

      clear(body);

      // Active
      const activeBody = active.length === 0
        ? el("div", { class: "ds-status", text: "No active data sources." })
        : el("div", { class: "ds-list" }, active.map((f) => frameworkRow(f, () => void render())));
      body.append(activeBody);

      body.append(el("div", { class: "ds-divider" }));

      // Add new → Detected + Manual
      const detectedBody = detected.length === 0
        ? el("div", { class: "ds-add-empty", text: "No data sources detected." })
        : el("div", { class: "ds-list" }, detected.map((f) => detectedRow(f, () => void render())));
      body.append(
        el("div", { class: "ds-group" }, [
          el("div", { class: "ds-subsection-title", text: "Detected" }),
          detectedBody,
        ]),
        el("div", { class: "ds-group" }, [
          el("div", { class: "ds-subsection-title", text: "Manual" }),
          manualControl(inactive, () => void render()),
        ]),
      );
    } catch {
      clear(body);
      body.append(el("div", { class: "ds-status", text: "Cannot reach server." }));
    }
  };

  const closeBtn = el("button", { class: "lm-icon-btn ds-close", "aria-label": "Close", text: "✕" });

  const modal = el("div", { class: "ds-modal" }, [
    el("div", { class: "ds-header" }, [
      el("h3", { class: "ds-title", text: "Manage Data Sources" }),
      closeBtn,
    ]),
    body,
  ]);

  const overlay = el("div", { class: "ds-overlay" }, [modal]);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
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
