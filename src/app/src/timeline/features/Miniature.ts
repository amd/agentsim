// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

import type { MiniLane } from "../core/buildVisData";

export interface MiniatureConfig {
  /** lane model for the current collapse state */
  getLanes: () => MiniLane[];
  /** real ms -> fraction [0..1] of the (compressed) timeline width */
  posFraction: (ms: number) => number;
  /** current visible window in milliseconds */
  getWindow: () => { startMs: number; endMs: number };
  /** move the window so it begins at fraction `f`, preserving its visible width */
  panToStartFraction: (f: number) => void;
}

export interface MiniatureHandle {
  el: HTMLElement;
  renderLanes: () => void;
  updateWindow: () => void;
  destroy: () => void;
}

/** Whole-timeline overview with a viewport indicator. */
export function createMiniature(config: MiniatureConfig): MiniatureHandle {
  const el = document.createElement("div");
  el.className = "tlw-miniature";

  const content = document.createElement("div");
  content.className = "tlw-mini-content";
  el.appendChild(content);

  const windowEl = document.createElement("div");
  windowEl.className = "tlw-mini-window";
  content.appendChild(windowEl);

  const pct = (ms: number) => config.posFraction(ms) * 100;

  const renderLanes = () => {
    content.querySelectorAll(".tlw-mini-clip").forEach((n) => n.remove());
    const lanes = config.getLanes();
    const laneH = lanes.length ? 100 / lanes.length : 100;
    lanes.forEach((lane, li) => {
      for (const [s, e] of lane.clips) {
        const left = pct(s);
        const right = pct(e);
        const bar = document.createElement("div");
        bar.className = "tlw-mini-clip";
        bar.style.left = left + "%";
        bar.style.width = Math.max(0, right - left) + "%";
        bar.style.top = li * laneH + "%";
        bar.style.height = laneH + "%";
        bar.style.backgroundColor = lane.color;
        content.insertBefore(bar, windowEl);
      }
    });
  };

  const updateWindow = () => {
    const { startMs, endMs } = config.getWindow();
    const left = Math.max(0, pct(startMs));
    const right = Math.min(100, pct(endMs));
    windowEl.style.left = left + "%";
    windowEl.style.width = Math.max(0, right - left) + "%";
  };

  // ---- drag the window indicator to pan the timeline (horizontal only) ----
  let dragging = false;
  let dragStartX = 0;
  let dragStartFraction = 0;

  const onWindowDown = (ev: MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    dragging = true;
    dragStartX = ev.clientX;
    dragStartFraction = config.posFraction(config.getWindow().startMs);
    windowEl.classList.add("dragging");
  };
  const onMove = (ev: MouseEvent) => {
    if (!dragging) return;
    const widthPx = content.getBoundingClientRect().width;
    if (widthPx <= 0) return;
    const deltaFraction = (ev.clientX - dragStartX) / widthPx;
    config.panToStartFraction(dragStartFraction + deltaFraction);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    windowEl.classList.remove("dragging");
  };

  windowEl.addEventListener("mousedown", onWindowDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  return {
    el,
    renderLanes,
    updateWindow,
    destroy: () => {
      windowEl.removeEventListener("mousedown", onWindowDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.remove();
    },
  };
}
