// Controls-bar menu definitions. Options are placeholders for now — each just
// logs so the wiring is visible; swap onSelect for real handlers later.

export interface MenuOption {
  label: string;
  shortcut?: string;
  wip?: boolean; // grayed out + "coming soon" tooltip; clicks ignored
  onSelect: () => void;
}

// A toggleable item. Rendered with a leading "✓" when checked (lemonade-style).
export interface MenuCheckbox {
  label: string;
  shortcut?: string;
  wip?: boolean; // grayed out + "coming soon" tooltip; clicks ignored
  checked: boolean;
  onToggle: (next: boolean) => void;
}

// A non-interactive section label that captions the items beneath it.
export interface MenuHeader {
  header: string;
}

// An inline numeric field: a label, a `<input type=number>`, and a unit suffix.
// Commits on change/Enter; the dropdown stays open while editing.
export interface MenuNumber {
  numberLabel: string;
  value: number;
  min?: number;
  suffix?: string;
  wip?: boolean;
  disabled?: boolean; // grayed out + non-editable (no tooltip, unlike wip)
  onChange: (next: number) => void;
}

// A menu item is a selectable option, a checkbox toggle, a number field, a
// section header, or a "divider" that splits the dropdown into sections.
export type MenuItem = MenuOption | MenuCheckbox | MenuNumber | MenuHeader | "divider";

export interface Menu {
  label: string;
  options: MenuItem[];
}

const placeholder = (name: string) => () => console.log(`[menu] ${name}`);

// Mark an interactive item as work-in-progress: the menu bar renders it grayed
// out with a hover tooltip and ignores clicks.
function wip<T extends MenuOption | MenuCheckbox>(item: T): T {
  item.wip = true;
  return item;
}

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

// Fire-and-forget timeline command: broadcasts a CustomEvent that the timeline
// controller (TimelinePanel) listens for and forwards to the widget.
const timelineAction = (event: string) => () => window.dispatchEvent(new CustomEvent(event));

// The two shrink-duration fields. They share state: "to" can't exceed "longer
// than" (a block can't shrink to more than its own fold threshold). Each field
// holds its own value (so a reopened dropdown shows the applied value) and
// broadcasts the combined params to the timeline controller, which forwards them
// to the widget. Grayed out until shrink is enabled (see shrinkToggle below).
const shrinkThresholdField: MenuNumber = {
  numberLabel: "Longer than",
  value: 600,
  min: 5,
  suffix: "sec",
  onChange: () => {},
};
const shrinkToField: MenuNumber = {
  numberLabel: "To",
  value: 60,
  min: 1,
  suffix: "sec",
  onChange: () => {},
};
const emitShrinkParams = () =>
  window.dispatchEvent(
    new CustomEvent("timeline:shrink-params", {
      detail: { thresholdSec: shrinkThresholdField.value, collapseToSec: shrinkToField.value },
    }),
  );
shrinkThresholdField.onChange = (v) => {
  shrinkThresholdField.value = Math.max(5, v);
  if (shrinkToField.value > shrinkThresholdField.value)
    shrinkToField.value = shrinkThresholdField.value;
  emitShrinkParams();
};
shrinkToField.onChange = (v) => {
  shrinkToField.value = Math.max(1, v);
  if (shrinkToField.value > shrinkThresholdField.value)
    shrinkThresholdField.value = shrinkToField.value;
  emitShrinkParams();
};

// Long-block shrink toggle: broadcasts its on/off state to the timeline
// controller and enables/disables the two duration fields to match. Holds its
// own checked state like the other menu checkboxes. When turning on, it first
// pushes the current field values so the widget folds at 600s→60s (its built-in
// defaults differ) rather than whatever it was last constructed with.
const shrinkToggleItem: MenuCheckbox = {
  label: "Shrink Long Blocks",
  checked: true,
  onToggle: (next) => {
    shrinkToggleItem.checked = next;
    shrinkThresholdField.disabled = !next;
    shrinkToField.disabled = !next;
    if (next) emitShrinkParams();
    window.dispatchEvent(new CustomEvent("timeline:shrink", { detail: { on: next } }));
  },
};

export const menus: Menu[] = [
  {
    label: "File",
    options: [
      {
        label: "Manage Data Sources",
        onSelect: () => window.dispatchEvent(new CustomEvent("file:manage-data-sources")),
      },
    ],
  },
  {
    label: "Tools",
    options: [
      wip({ label: "Compare Sessions", onSelect: placeholder("Tools > Compare Sessions") }),
      "divider",
      { header: "A/B Test" },
      wip({ label: "Skills", onSelect: placeholder("Tools > A/B Test > Skills") }),
      wip({ label: "Prompts", onSelect: placeholder("Tools > A/B Test > Prompts") }),
    ],
  },
  {
    label: "View",
    options: [
      viewToggle("Show Sessions", "view:sessions", true),
      viewToggle("Show Timeline Miniature", "view:timeline-miniature", true),
    ],
  },
  {
    label: "Timeline",
    options: [
      { label: "Zoom In", onSelect: timelineAction("timeline:zoom-in") },
      { label: "Zoom Out", onSelect: timelineAction("timeline:zoom-out") },
      { label: "Fit", onSelect: timelineAction("timeline:fit") },
      "divider",
      { label: "Expand All", onSelect: timelineAction("timeline:expand-all") },
      { label: "Collapse All", onSelect: timelineAction("timeline:collapse-all") },
      "divider",
      shrinkToggleItem,
      shrinkThresholdField,
      shrinkToField,
      "divider",
      wip(checkbox("Show Token Usage", true)),
    ],
  },
  {
    label: "Help",
    options: [
      wip({ label: "Documentation", onSelect: placeholder("Help > Documentation") }),
      wip({ label: "Keyboard Shortcuts", onSelect: placeholder("Help > Keyboard Shortcuts") }),
      wip({ label: "About", onSelect: placeholder("Help > About") }),
    ],
  },
];
