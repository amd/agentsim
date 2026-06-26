export interface ToolbarActions {
  fit: () => void;
  collapseAll: () => void;
  expandAll: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setShrinkLongBlocks: (on: boolean) => void;
  setShrinkParams: (thresholdSec: number, collapseToSec: number) => void;
}

export interface ToolbarState {
  shrinkLongBlocks: boolean;
  shrinkThresholdSec: number;
  shrinkToSec: number;
}

export interface ToolbarHandle {
  el: HTMLElement;
  destroy: () => void;
}

const button = (
  label: string,
  onClick: () => void,
  opts: { className?: string; title?: string } = {},
): HTMLButtonElement => {
  const b = document.createElement("button");
  b.className = opts.className ?? "lm-btn lm-btn-secondary";
  b.textContent = label;
  if (opts.title) b.title = opts.title;
  b.addEventListener("click", onClick);
  return b;
};

const separator = (): HTMLSpanElement => {
  const sep = document.createElement("span");
  sep.className = "tlw-sep";
  return sep;
};

/** A `<label> text <input type=number> s` field; commits on change/Enter. */
const numberField = (
  label: string,
  value: number,
  onChange: (v: number) => void,
  opts: { min?: number; suffix?: string } = {},
): { wrap: HTMLLabelElement; input: HTMLInputElement } => {
  const wrap = document.createElement("label");
  wrap.className = "tlw-field";

  const text = document.createElement("span");
  text.className = "tlw-field-label";
  text.textContent = label;

  const input = document.createElement("input");
  input.type = "number";
  input.className = "tlw-field-input";
  input.value = String(value);
  if (opts.min !== undefined) input.min = String(opts.min);
  input.addEventListener("change", () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onChange(v);
  });

  wrap.append(text, input);
  if (opts.suffix) {
    const suf = document.createElement("span");
    suf.className = "tlw-field-suffix";
    suf.textContent = opts.suffix;
    wrap.appendChild(suf);
  }
  return { wrap, input };
};

/** Fit / collapse-all / expand-all / zoom / shrink bar + drag/zoom hints. */
export function createToolbar(
  actions: ToolbarActions,
  state: ToolbarState,
): ToolbarHandle {
  const el = document.createElement("header");
  el.className = "tlw-toolbar";

  let shrink = state.shrinkLongBlocks;
  let thresholdSec = state.shrinkThresholdSec;
  let toSec = state.shrinkToSec;

  // Clamp the threshold to >= 5s and "down to" to >= 1s, keeping "down to" <=
  // "longer than" (a block can't shrink to more than its own fold threshold).
  // Corrected values are written back so the UI always shows what's applied.
  const commit = () => {
    let t = Number(thresholdField.input.value);
    let d = Number(toField.input.value);
    if (!Number.isFinite(t) || t < 5) t = 5;
    if (!Number.isFinite(d) || d < 1) d = 1;
    if (d > t) d = t;
    thresholdSec = t;
    toSec = d;
    thresholdField.input.value = String(t);
    toField.input.value = String(d);
    actions.setShrinkParams(t, d);
  };

  const thresholdField = numberField("longer than", thresholdSec, commit, {
    min: 5,
    suffix: "s",
  });
  const toField = numberField("down to", toSec, commit, { min: 1, suffix: "s" });

  const syncFieldsDisabled = () => {
    thresholdField.input.disabled = !shrink;
    toField.input.disabled = !shrink;
    thresholdField.wrap.classList.toggle("is-disabled", !shrink);
    toField.wrap.classList.toggle("is-disabled", !shrink);
  };

  const shrinkBtn = button(
    "Shrink long blocks",
    () => {
      shrink = !shrink;
      shrinkBtn.classList.toggle("is-active", shrink);
      shrinkBtn.setAttribute("aria-pressed", String(shrink));
      actions.setShrinkLongBlocks(shrink);
      syncFieldsDisabled();
    },
    {
      className: "lm-btn lm-btn-secondary tlw-shrink-btn",
      title: "Compress blocks longer than the threshold",
    },
  );
  shrinkBtn.classList.toggle("is-active", shrink);
  shrinkBtn.setAttribute("aria-pressed", String(shrink));
  syncFieldsDisabled();

  el.append(
    button("Fit", actions.fit),
    button("Collapse all", actions.collapseAll),
    button("Expand all", actions.expandAll),
    separator(),
    button("−", actions.zoomOut, {
      className: "lm-btn lm-btn-secondary tlw-zoom-btn",
      title: "Zoom out",
    }),
    button("+", actions.zoomIn, {
      className: "lm-btn lm-btn-secondary tlw-zoom-btn",
      title: "Zoom in",
    }),
    separator(),
    shrinkBtn,
    thresholdField.wrap,
    toField.wrap,
  );

  el.appendChild(separator());

  for (const text of ["drag to navigate", "scroll to zoom"]) {
    const hint = document.createElement("span");
    hint.className = "tlw-hint";
    hint.textContent = text;
    el.appendChild(hint);
  }

  return {
    el,
    destroy: () => el.remove(),
  };
}
