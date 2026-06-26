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

// Long-block shrink toggle: broadcasts its on/off state to the timeline
// controller. Holds its own checked state like the other menu checkboxes.
const shrinkToggle = (): MenuCheckbox => {
  const item: MenuCheckbox = {
    label: "Shrink Long Blocks",
    checked: false,
    onToggle: (next) => {
      item.checked = next;
      window.dispatchEvent(new CustomEvent("timeline:shrink", { detail: { on: next } }));
    },
  };
  return item;
};

// The two shrink-duration fields. They share state: "to" can't exceed "longer
// than" (a block can't shrink to more than its own fold threshold). Each field
// holds its own value (so a reopened dropdown shows the applied value) and
// broadcasts the combined params to the timeline controller, which forwards them
// to the widget. Mirrors the widget defaults (10s threshold, 2s collapse-to).
const shrinkThresholdField: MenuNumber = {
  numberLabel: "Longer than",
  value: 10,
  min: 5,
  suffix: "sec",
  onChange: () => {},
};
const shrinkToField: MenuNumber = {
  numberLabel: "To",
  value: 2,
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
      viewToggle("Show Block Explorer", "view:block-info", true),
      viewToggle("Show Timeline Miniature", "view:timeline-miniature", true),
      "divider",
      { header: "Timeline" },
      { label: "Zoom In", onSelect: timelineAction("timeline:zoom-in") },
      { label: "Zoom Out", onSelect: timelineAction("timeline:zoom-out") },
      { label: "Fit", onSelect: timelineAction("timeline:fit") },
      { label: "Expand All", onSelect: timelineAction("timeline:expand-all") },
      { label: "Collapse All", onSelect: timelineAction("timeline:collapse-all") },
      shrinkToggle(),
      shrinkThresholdField,
      shrinkToField,
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
