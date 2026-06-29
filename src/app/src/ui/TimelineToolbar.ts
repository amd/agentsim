import { el } from "./dom.js";

// Dedicated timeline toolbar, docked at the top of the primary timeline section.
// It owns every control that used to live in the "Timeline" menu and drives the
// widget through the same `timeline:*` CustomEvents the controller (TimelinePanel)
// already listens for — so this is a pure UI surface with no widget reference.

const emit = (event: string, detail?: unknown) =>
  window.dispatchEvent(detail === undefined ? new CustomEvent(event) : new CustomEvent(event, { detail }));

// Defaults mirror the controller's initial shrink state (on, fold >600s → 60s).
const DEFAULT_THRESHOLD_SEC = 600;
const DEFAULT_TO_SEC = 60;

function actionButton(
  label: string,
  event: string,
  opts: { title?: string; icon?: boolean } = {},
): HTMLButtonElement {
  const btn = el("button", {
    class: `tl-tb-btn${opts.icon ? " tl-tb-icon" : ""}`,
    type: "button",
    text: label,
    ...(opts.title ? { title: opts.title } : {}),
  }) as HTMLButtonElement;
  btn.addEventListener("click", () => emit(event));
  return btn;
}

const sep = (): HTMLElement => el("span", { class: "tl-tb-sep" });

export function createTimelineToolbar(): HTMLElement {
  // ---- fold controls --------------------------------------------------------
  // One front-end toggle ("Shrink Long Regions") drives BOTH backend folds at
  // once — long blocks and empty regions — so the user sees a single control.
  // They share one pair of numeric fields with clamping rules: threshold >= 5s,
  // "to" >= 1s, and "to" can never exceed the threshold (a stretch can't fold to
  // more than its own length). Corrected values are written back so the inputs
  // always show what is applied, then broadcast as a combined params event.
  // Default on, matching the controller.
  let foldOn = true;

  const thresholdInput = el("input", {
    class: "tl-tb-num",
    type: "number",
    min: "5",
    value: String(DEFAULT_THRESHOLD_SEC),
  }) as HTMLInputElement;
  const toInput = el("input", {
    class: "tl-tb-num",
    type: "number",
    min: "1",
    value: String(DEFAULT_TO_SEC),
  }) as HTMLInputElement;

  const emitParams = () =>
    emit("timeline:shrink-params", {
      thresholdSec: Number(thresholdInput.value),
      collapseToSec: Number(toInput.value),
    });

  const commitParams = () => {
    let t = Number(thresholdInput.value);
    let d = Number(toInput.value);
    if (!Number.isFinite(t) || t < 5) t = 5;
    if (!Number.isFinite(d) || d < 1) d = 1;
    if (d > t) d = t;
    thresholdInput.value = String(t);
    toInput.value = String(d);
    emitParams();
  };

  for (const input of [thresholdInput, toInput]) {
    input.addEventListener("change", commitParams);
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") commitParams();
    });
  }

  const field = (label: string, input: HTMLInputElement): HTMLElement =>
    el("label", { class: "tl-tb-field" }, [
      el("span", { class: "tl-tb-field-label", text: label }),
      input,
      el("span", { class: "tl-tb-field-suffix", text: "sec" }),
    ]);

  const thresholdField = field("longer than", thresholdInput);
  const toField = field("to", toInput);

  // Fields are live while the fold is on (both backends share these params).
  const syncFieldsDisabled = () => {
    const off = !foldOn;
    thresholdInput.disabled = off;
    toInput.disabled = off;
    thresholdField.classList.toggle("is-disabled", off);
    toField.classList.toggle("is-disabled", off);
  };

  // Single fold toggle: flips state, reflects the pressed look, syncs the shared
  // fields, and drives BOTH backend folds (long blocks + empty regions). On
  // enable it re-pushes the current params so the widget folds at the field
  // values rather than whatever it was last constructed with.
  const shrinkBtn = el("button", {
    class: `tl-tb-btn tl-tb-toggle${foldOn ? " is-active" : ""}`,
    type: "button",
    text: "Shrink Long Regions",
    "aria-pressed": String(foldOn),
    title: "Compress blocks and empty gaps longer than the threshold",
  }) as HTMLButtonElement;
  shrinkBtn.addEventListener("click", () => {
    foldOn = !foldOn;
    shrinkBtn.classList.toggle("is-active", foldOn);
    shrinkBtn.setAttribute("aria-pressed", String(foldOn));
    syncFieldsDisabled();
    if (foldOn) emitParams();
    emit("timeline:shrink", { on: foldOn });
    emit("timeline:collapse-empty", { on: foldOn });
  });

  // Standalone view filter (no shared params): hides rows with nothing in view.
  const hideEmptyRowsBtn = simpleToggle(
    "Hide Empty Rows",
    "timeline:hide-empty-rows",
    true,
    "Hide rows that have no blocks in the current view",
  );

  return el("div", { class: "tl-toolbar" }, [
    actionButton("+", "timeline:zoom-in", { title: "Zoom in", icon: true }),
    actionButton("−", "timeline:zoom-out", { title: "Zoom out", icon: true }),
    actionButton("Fit", "timeline:fit"),
    sep(),
    actionButton("Expand All", "timeline:expand-all"),
    actionButton("Collapse All", "timeline:collapse-all"),
    hideEmptyRowsBtn,
    sep(),
    shrinkBtn,
    thresholdField,
    toField,
  ]);
}

// A self-contained on/off toggle button that broadcasts `event` with `{ on }`.
function simpleToggle(
  label: string,
  event: string,
  initial: boolean,
  title: string,
): HTMLButtonElement {
  const btn = el("button", {
    class: `tl-tb-btn tl-tb-toggle${initial ? " is-active" : ""}`,
    type: "button",
    text: label,
    "aria-pressed": String(initial),
    title,
  }) as HTMLButtonElement;
  let on = initial;
  btn.addEventListener("click", () => {
    on = !on;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
    window.dispatchEvent(new CustomEvent(event, { detail: { on } }));
  });
  return btn;
}
