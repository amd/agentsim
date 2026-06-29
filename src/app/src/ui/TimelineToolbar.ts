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
  // ---- shrink controls ------------------------------------------------------
  // Two number fields share clamping rules: threshold >= 5s, "to" >= 1s, and
  // "to" can never exceed the threshold (a block can't fold to more than its own
  // fold size). Corrected values are written back so the inputs always show what
  // is actually applied, then broadcast as a combined params event.
  let shrinkOn = true;

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

  const thresholdField = field("Longer than", thresholdInput);
  const toField = field("To", toInput);

  const syncFieldsDisabled = () => {
    thresholdInput.disabled = !shrinkOn;
    toInput.disabled = !shrinkOn;
    thresholdField.classList.toggle("is-disabled", !shrinkOn);
    toField.classList.toggle("is-disabled", !shrinkOn);
  };

  const shrinkBtn = el("button", {
    class: "tl-tb-btn tl-tb-toggle is-active",
    type: "button",
    text: "Shrink Long Blocks",
    "aria-pressed": "true",
    title: "Compress blocks longer than the threshold",
  }) as HTMLButtonElement;
  shrinkBtn.addEventListener("click", () => {
    shrinkOn = !shrinkOn;
    shrinkBtn.classList.toggle("is-active", shrinkOn);
    shrinkBtn.setAttribute("aria-pressed", String(shrinkOn));
    syncFieldsDisabled();
    // Re-push params on enable so the widget folds at the field values rather than
    // whatever it was last constructed with, then toggle the feature.
    if (shrinkOn) emitParams();
    emit("timeline:shrink", { on: shrinkOn });
  });

  return el("div", { class: "tl-toolbar" }, [
    actionButton("+", "timeline:zoom-in", { title: "Zoom in", icon: true }),
    actionButton("−", "timeline:zoom-out", { title: "Zoom out", icon: true }),
    actionButton("Fit", "timeline:fit"),
    sep(),
    actionButton("Expand All", "timeline:expand-all"),
    actionButton("Collapse All", "timeline:collapse-all"),
    sep(),
    shrinkBtn,
    thresholdField,
    toField,
  ]);
}
