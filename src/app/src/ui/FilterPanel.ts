import { el } from "./dom.js";
import type { Conversation, Tag } from "../data/conversations.js";
import { SECTIONS, type Section, sectionFor } from "../data/sections.js";

// Frameworks are every tag except the "live" marker.
export type Framework = Exclude<Tag, "live">;

// Combined filter state. Empty sets / "all" / false each mean "no constraint".
export interface Filters {
  frameworks: Set<Framework>;
  live: boolean;
  projects: Set<string>; // full project paths
  date: Section | "all";
}

export function emptyFilters(): Filters {
  return { frameworks: new Set(), live: false, projects: new Set(), date: "all" };
}

export function matchesFilters(c: Conversation, f: Filters, startOfTodayMs: number): boolean {
  if (f.frameworks.size > 0 && !c.tags.some((t) => f.frameworks.has(t as Framework))) return false;
  if (f.live && !c.tags.includes("live")) return false;
  if (f.projects.size > 0 && !f.projects.has(c.projectPath)) return false;
  if (f.date !== "all" && sectionFor(c.date, startOfTodayMs) !== f.date) return false;
  return true;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

// Distinct frameworks across all conversations, in first-seen order.
function frameworkOptions(items: Conversation[]): Framework[] {
  const seen = new Set<Framework>();
  for (const c of items) for (const t of c.tags) if (t !== "live") seen.add(t);
  return [...seen];
}

// Distinct projects (full path + display name), in first-seen order.
function projectOptions(items: Conversation[]): { path: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const c of items) if (!seen.has(c.projectPath)) seen.set(c.projectPath, basename(c.projectPath));
  return [...seen].map(([path, name]) => ({ path, name }));
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
function multiPills<T extends string>(
  values: T[],
  set: Set<T>,
  onChange: () => void,
): Control {
  const all = el("span", { class: "tag-pill", text: "All" });
  const pills = values.map((v) => el("span", { class: "tag-pill", text: v, "data-v": v }));
  const sync = () => {
    all.classList.toggle("active", set.size === 0);
    for (const p of pills) p.classList.toggle("active", set.has(p.dataset.v as T));
  };
  all.addEventListener("click", () => {
    set.clear();
    sync();
    onChange();
  });
  for (const p of pills) {
    p.addEventListener("click", () => {
      const v = p.dataset.v as T;
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

// The 4-section filter window. Owns its own Filters instance and fires onChange
// with it on every change.
export function createFilterPanel(
  conversations: Conversation[],
  onChange: (f: Filters) => void,
): HTMLElement {
  const filters = emptyFilters();

  const anyApplied = () =>
    filters.frameworks.size > 0 ||
    filters.live ||
    filters.projects.size > 0 ||
    filters.date !== "all";

  const reset = el("button", { class: "filter-reset", text: "Reset filters" });
  const syncReset = () => {
    reset.style.display = anyApplied() ? "" : "none";
  };

  const fire = () => {
    syncReset();
    onChange(filters);
  };

  const frameworks = multiPills(frameworkOptions(conversations), filters.frameworks, fire);

  const projects = checkboxList(projectOptions(conversations), filters.projects, fire);

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
    filters.date = "all";
    frameworks.sync();
    projects.sync();
    live.sync();
    date.sync();
    fire();
  });

  syncReset();

  return el("div", { class: "filter-panel" }, [
    reset,
    section("Framework", frameworks.node),
    section("Project", projects.node),
    section("Live", live.node),
    section("Date / Time", date.node),
  ]);
}
