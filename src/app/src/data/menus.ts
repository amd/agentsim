// Controls-bar menu definitions. Options are placeholders for now — each just
// logs so the wiring is visible; swap onSelect for real handlers later.

export interface MenuOption {
  label: string;
  shortcut?: string;
  onSelect: () => void;
}

export interface Menu {
  label: string;
  options: MenuOption[];
}

const placeholder = (name: string) => () => console.log(`[menu] ${name}`);

export const menus: Menu[] = [
  {
    label: "File",
    options: [
      { label: "New Conversation", shortcut: "Ctrl+N", onSelect: placeholder("File > New Conversation") },
      { label: "Open…", shortcut: "Ctrl+O", onSelect: placeholder("File > Open") },
      { label: "Export…", onSelect: placeholder("File > Export") },
    ],
  },
  {
    label: "Tools",
    options: [
      { label: "Model Manager", onSelect: placeholder("Tools > Model Manager") },
      { label: "Settings", onSelect: placeholder("Tools > Settings") },
      { label: "Logs", onSelect: placeholder("Tools > Logs") },
    ],
  },
  {
    label: "View",
    options: [
      { label: "Toggle Sidebar", shortcut: "Ctrl+B", onSelect: placeholder("View > Toggle Sidebar") },
      { label: "Zoom In", shortcut: "Ctrl+=", onSelect: placeholder("View > Zoom In") },
      { label: "Zoom Out", shortcut: "Ctrl+-", onSelect: placeholder("View > Zoom Out") },
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
