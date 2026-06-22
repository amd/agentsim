import { el, clear } from "./dom.js";
import {
  addFramework,
  fetchAvailableFrameworks,
  fetchDetectedFrameworks,
  fetchFrameworks,
  removeFramework,
  type FrameworkInfo,
} from "../data/api.js";

// Tell the rest of the app the active set changed so dependent views (e.g. the
// sidebar's session list) re-fetch instead of showing stale data.
function notifyChanged(): void {
  window.dispatchEvent(new CustomEvent("frameworks:changed"));
}

// "#RRGGBB" -> "rgba(r, g, b, a)", for a subtle background wash in the brand color.
function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "transparent";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Carry the framework's brand color on the whole row: colored name, accent
// border, and a faint background wash.
function paintRow(row: HTMLElement, name: HTMLElement, color: string): void {
  if (!color) return;
  name.style.color = color;
  row.style.borderColor = tint(color, 0.5);
  row.style.borderLeft = `3px solid ${color}`;
  row.style.background = tint(color, 0.12);
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

  const name = el("div", { class: "ds-row-name", text: fw.name });
  const row = el("div", { class: "ds-row" }, [
    el("div", { class: "ds-row-text" }, [
      name,
      el("div", { class: "ds-row-meta", text: meta }),
    ]),
    del,
  ]);
  paintRow(row, name, fw.primary_color);
  return row;
}

// Render one auto-detected framework: its name + discovered path, with a
// one-click Add that activates it at that default location.
function detectedRow(fw: FrameworkInfo, refresh: () => void): HTMLElement {
  const add = el("button", { class: "lm-btn lm-btn-accent", text: "Add", title: `Add ${fw.name}` });
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

  const name = el("div", { class: "ds-row-name", text: fw.name });
  const row = el("div", { class: "ds-row" }, [
    el("div", { class: "ds-row-text" }, [
      name,
      el("div", { class: "ds-row-meta", text: fw.data_basepath }),
    ]),
    add,
  ]);
  paintRow(row, name, fw.primary_color);
  return row;
}

// Build the "add a data source" control: a picker of catalog frameworks not yet
// active, an optional data-path override, and an Add button.
function addControl(inactive: FrameworkInfo[], refresh: () => void): HTMLElement {
  if (inactive.length === 0) {
    return el("div", { class: "ds-add-empty", text: "All available data sources are active." });
  }

  const select = el("select", { class: "lm-select" },
    inactive.map((f) => el("option", { value: f.alias, text: f.name })),
  );
  const path = el("input", {
    class: "lm-input",
    type: "text",
    placeholder: "Data path (optional — uses default)",
  });
  const add = el("button", { class: "lm-btn lm-btn-accent", text: "Add" });
  const error = el("div", { class: "ds-add-error" });

  add.addEventListener("click", async () => {
    add.disabled = true;
    error.textContent = "";
    try {
      await addFramework(select.value, path.value.trim());
      notifyChanged();
      refresh();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : "Failed to add data source.";
      add.disabled = false;
    }
  });

  return el("div", { class: "ds-add" }, [
    el("div", { class: "ds-add-row" }, [select, path, add]),
    error,
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
      body.append(el("div", { class: "ds-section-title", text: "Active" }));
      if (active.length === 0) {
        body.append(el("div", { class: "ds-status", text: "No active data sources." }));
      } else {
        body.append(
          el("div", { class: "ds-list" }, active.map((f) => frameworkRow(f, () => void render()))),
        );
      }

      if (detected.length > 0) {
        body.append(el("div", { class: "ds-section-title", text: "Detected" }));
        body.append(
          el("div", { class: "ds-list" }, detected.map((f) => detectedRow(f, () => void render()))),
        );
      }

      body.append(el("div", { class: "ds-section-title", text: "Add data source" }));
      body.append(addControl(inactive, () => void render()));
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
