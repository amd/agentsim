import { el } from "./dom.js";
import { SECTIONS, type Section } from "../data/sections.js";
import type { Facets } from "../data/api.js";

// Combined filter state, sent to the backend on every change. Empty sets / "all"
// / false each mean "no constraint". `frameworks` holds backend aliases.
export interface Filters {
  frameworks: Set<string>;
  live: boolean;
  projects: Set<string>; // full project paths
  models: Set<string>;
  date: Section | "all";
}

export function emptyFilters(): Filters {
  return {
    frameworks: new Set(),
    live: false,
    projects: new Set(),
    models: new Set(),
    date: "all",
  };
}

function section(title: string, control: HTMLElement): HTMLElement {
  return el("div", { class: "filter-section" }, [
    el("div", { class: "filter-section-title", text: title }),
    control,
  ]);
}

// A filter control: its DOM node plus a sync() that repaints it from state.
interface Control {
  node: HTMLElement;
  sync: () => void;
}

// Multi-select pill row with an "All" reset (empty set = all).
function multiPills(
  options: { value: string; label: string }[],
  set: Set<string>,
  onChange: () => void,
): Control {
  const all = el("span", { class: "tag-pill", text: "All" });
  const pills = options.map((o) => el("span", { class: "tag-pill", text: o.label, "data-v": o.value }));
  const sync = () => {
    all.classList.toggle("active", set.size === 0);
    for (const p of pills) p.classList.toggle("active", set.has(p.dataset.v!));
  };
  all.addEventListener("click", () => {
    set.clear();
    sync();
    onChange();
  });
  for (const p of pills) {
    p.addEventListener("click", () => {
      const v = p.dataset.v!;
      if (set.has(v)) set.delete(v);
      else set.add(v);
      sync();
      onChange();
    });
  }
  sync();
  return { node: el("div", { class: "tag-filter" }, [all, ...pills]), sync };
}

// Single-select pill row.
function singlePills(
  options: { value: string; label: string }[],
  get: () => string,
  set: (v: string) => void,
  onChange: () => void,
): Control {
  const pills = options.map((o) =>
    el("span", { class: "tag-pill", text: o.label, "data-v": o.value }),
  );
  const sync = () => {
    for (const p of pills) p.classList.toggle("active", p.dataset.v === get());
  };
  for (const p of pills) {
    p.addEventListener("click", () => {
      set(p.dataset.v!);
      sync();
      onChange();
    });
  }
  sync();
  return { node: el("div", { class: "tag-filter" }, pills), sync };
}

// Checkbox list (empty selection = all).
function checkboxList(
  options: { path: string; name: string }[],
  set: Set<string>,
  onChange: () => void,
): Control {
  const inputs: HTMLInputElement[] = [];
  const rows = options.map((o) => {
    const input = el("input", { type: "checkbox" }) as HTMLInputElement;
    input.checked = set.has(o.path);
    input.addEventListener("change", () => {
      if (input.checked) set.add(o.path);
      else set.delete(o.path);
      onChange();
    });
    inputs.push(input);
    return el("label", { class: "filter-check", title: o.path }, [
      input,
      el("span", { text: o.name }),
    ]);
  });
  const sync = () => {
    for (let i = 0; i < inputs.length; i++) inputs[i].checked = set.has(options[i].path);
  };
  return { node: el("div", { class: "filter-check-list" }, rows), sync };
}

// The 4-section filter window. Options come from backend facets; it owns its own
// Filters instance and fires onChange with it on every change.
export function createFilterPanel(
  facets: Facets,
  onChange: (f: Filters) => void,
): HTMLElement {
  const filters = emptyFilters();

  const anyApplied = () =>
    filters.frameworks.size > 0 ||
    filters.live ||
    filters.projects.size > 0 ||
    filters.models.size > 0 ||
    filters.date !== "all";

  const reset = el("button", { class: "filter-reset", text: "Reset filters" });
  const syncReset = () => {
    reset.style.display = anyApplied() ? "" : "none";
  };

  const fire = () => {
    syncReset();
    onChange(filters);
  };

  const frameworks = multiPills(
    facets.frameworks.map((f) => ({ value: f.alias, label: f.name })),
    filters.frameworks,
    fire,
  );

  const projects = checkboxList(
    facets.projects.map((p) => ({ path: p.path, name: p.name })),
    filters.projects,
    fire,
  );

  const models = multiPills(
    facets.models.map((m) => ({ value: m.name, label: m.name })),
    filters.models,
    fire,
  );

  const live = singlePills(
    [
      { value: "all", label: "All" },
      { value: "live", label: "Live" },
    ],
    () => (filters.live ? "live" : "all"),
    (v) => {
      filters.live = v === "live";
    },
    fire,
  );

  const date = singlePills(
    [{ value: "all", label: "All" }, ...SECTIONS.map((s) => ({ value: s, label: s }))],
    () => filters.date,
    (v) => {
      filters.date = v as Section | "all";
    },
    fire,
  );

  reset.addEventListener("click", () => {
    filters.frameworks.clear();
    filters.live = false;
    filters.projects.clear();
    filters.models.clear();
    filters.date = "all";
    frameworks.sync();
    projects.sync();
    models.sync();
    live.sync();
    date.sync();
    fire();
  });

  syncReset();

  return el("div", { class: "filter-panel" }, [
    reset,
    section("Framework", frameworks.node),
    section("Model", models.node),
    section("Project", projects.node),
    section("Live", live.node),
    section("Date / Time", date.node),
  ]);
}
