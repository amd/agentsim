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

export const menus: Menu[] = [
  {
    label: "File",
    options: [
      { label: "Add data source", onSelect: placeholder("File > Add data source") },
      { label: "Remove data source", onSelect: placeholder("File > Remove data source") },
    ],
  },
  {
    label: "Tools",
    options: [
      { label: "A/B test (skills)", onSelect: placeholder("Tools > A/B test (skills)") },
      { label: "A/B Test (prompts)", onSelect: placeholder("Tools > A/B Test (prompts)") },
      { label: "Compare Sessions", onSelect: placeholder("Tools > Compare Sessions") },
    ],
  },
  {
    label: "View",
    options: [
      checkbox("Show sessions", true),
      checkbox("Show block explorer", true),
      checkbox("Show timeline miniature", true),
      "divider",
      { header: "Timeline" },
      { label: "Fit", onSelect: placeholder("View > Fit") },
      { label: "Expand all", onSelect: placeholder("View > Expand all") },
      { label: "Collapse all", onSelect: placeholder("View > Collapse all") },
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
