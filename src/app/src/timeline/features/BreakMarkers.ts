import type { Interval } from "../core/intervals";

/* Axis overlay marking each collapsed (hidden) range. Two aligned layers share
   the same screen x (both panels start at the same left edge): a red vertical
   line through the chart (in the center panel) and a pair of time chips — `from`
   (where the fold starts) and `to` (where it resumes) — lifted into the axis
   label band (the top panel) so they sit above the lanes instead of over them.
   Since the whole range is folded, its start and end map to the same pixel.
   Positions are recomputed on every range change. */

export interface BreakMarkersConfig {
  /** the element vis-timeline renders into */
  root: HTMLElement;
  getBreaks: () => Interval[];
  /** ms (widget time) -> x within the center panel; must be hidden-dates aware */
  toScreen: (ms: number) => number;
  /** label formatter (e.g. m:ss) */
  fmt: (ms: number) => string;
}

export interface BreakMarkersHandle {
  /** rebuild markers from the current break set */
  render: () => void;
  /** recompute x positions for the current window */
  reposition: () => void;
  destroy: () => void;
}

export function createBreakMarkers(config: BreakMarkersConfig): BreakMarkersHandle {
  let lineLayer: HTMLDivElement | null = null;
  let labelLayer: HTMLDivElement | null = null;

  const ensureLayers = (): boolean => {
    const center = config.root.querySelector(
      ".vis-panel.vis-center",
    ) as HTMLElement | null;
    const top = config.root.querySelector(".vis-panel.vis-top") as HTMLElement | null;
    if (!center || !top) return false;
    if (!lineLayer || lineLayer.parentElement !== center) {
      lineLayer = document.createElement("div");
      lineLayer.className = "tlw-break-lines";
      center.appendChild(lineLayer);
    }
    if (!labelLayer || labelLayer.parentElement !== top) {
      labelLayer = document.createElement("div");
      labelLayer.className = "tlw-break-labels";
      top.appendChild(labelLayer);
    }
    return true;
  };

  const reposition = () => {
    if (!lineLayer || !labelLayer) return;
    const breaks = config.getBreaks();
    for (let i = 0; i < breaks.length; i++) {
      const x = config.toScreen(breaks[i][0]) + "px";
      const line = lineLayer.children[i] as HTMLElement | undefined;
      const label = labelLayer.children[i] as HTMLElement | undefined;
      if (line) line.style.left = x;
      if (label) label.style.left = x;
    }
  };

  const render = () => {
    if (!ensureLayers()) return;
    lineLayer!.innerHTML = "";
    labelLayer!.innerHTML = "";
    for (const [startMs, endMs] of config.getBreaks()) {
      const line = document.createElement("div");
      line.className = "tlw-break-line";
      lineLayer!.appendChild(line);

      const group = document.createElement("div");
      group.className = "tlw-break";

      const from = document.createElement("span");
      from.className = "tlw-break-label tlw-break-from";
      from.textContent = config.fmt(startMs);

      const to = document.createElement("span");
      to.className = "tlw-break-label tlw-break-to";
      to.textContent = config.fmt(endMs);

      group.append(from, to);
      labelLayer!.appendChild(group);
    }
    reposition();
  };

  return {
    render,
    reposition,
    destroy: () => {
      lineLayer?.remove();
      labelLayer?.remove();
      lineLayer = null;
      labelLayer = null;
    },
  };
}
