// Controls-bar menu definitions. Options are placeholders for now — each just
// logs so the wiring is visible; swap onSelect for real handlers later.

export interface MenuOption {
  label: string;
  shortcut?: string;
  onSelect: () => void;
}

// A toggleable item. Rendered with a leading "✓" when checked (lemonade-style).
export interface MenuCheckbox {
  label: string;
  shortcut?: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
}

// A non-interactive section label that captions the items beneath it.
export interface MenuHeader {
  header: string;
}

// A menu item is a selectable option, a checkbox toggle, a section header, or a
// "divider" that splits the dropdown into sections.
export type MenuItem = MenuOption | MenuCheckbox | MenuHeader | "divider";

export interface Menu {
  label: string;
  options: MenuItem[];
}

const placeholder = (name: string) => () => console.log(`[menu] ${name}`);

// Checkbox factory: holds its own checked state and logs on toggle (placeholder
// until wired to real view state).
const checkbox = (name: string, checked: boolean): MenuCheckbox => {
  const item: MenuCheckbox = {
    label: name,
    checked,
    onToggle: (next) => {
      item.checked = next;
      console.log(`[menu] ${name} -> ${next}`);
    },
  };
  return item;
};

// Panel-visibility toggle: `checked` is the source of truth for the panel's
// visibility, and each toggle broadcasts a CustomEvent that AppShell listens for
// to show/hide the matching panel (lemonade-style lifted state).
const viewToggle = (name: string, event: string, checked: boolean): MenuCheckbox => {
  const item: MenuCheckbox = {
    label: name,
    checked,
    onToggle: (next) => {
      item.checked = next;
      window.dispatchEvent(new CustomEvent(event, { detail: { visible: next } }));
    },
  };
  return item;
};

export const menus: Menu[] = [
  {
    label: "File",
    options: [
      { header: "Data Source" },
      { label: "Add", onSelect: placeholder("File > Data Source > Add") },
      { label: "Remove", onSelect: placeholder("File > Data Source > Remove") },
    ],
  },
  {
    label: "Tools",
    options: [
      { label: "Compare Sessions", onSelect: placeholder("Tools > Compare Sessions") },
      "divider",
      { header: "A/B Test" },
      { label: "Skills", onSelect: placeholder("Tools > A/B Test > Skills") },
      { label: "Prompts", onSelect: placeholder("Tools > A/B Test > Prompts") },
    ],
  },
  {
    label: "View",
    options: [
      viewToggle("Show Sessions", "view:sessions", true),
      viewToggle("Show Block Explorer", "view:block-info", true),
      viewToggle("Show Timeline Miniature", "view:timeline-miniature", true),
      "divider",
      { header: "Timeline" },
      { label: "Fit", onSelect: placeholder("View > Fit") },
      { label: "Expand All", onSelect: placeholder("View > Expand All") },
      { label: "Collapse All", onSelect: placeholder("View > Collapse All") },
      checkbox("Show Token Usage", true),
    ],
  },
  {
    label: "Help",
    options: [
      { label: "Documentation", onSelect: placeholder("Help > Documentation") },
      { label: "Keyboard Shortcuts", onSelect: placeholder("Help > Keyboard Shortcuts") },
      { label: "About", onSelect: placeholder("Help > About") },
    ],
  },
];
