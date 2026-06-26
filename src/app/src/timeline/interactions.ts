/* Cursor-anchored wheel zoom + vertical drag-to-scroll, ported as an attachable
   unit. vis owns horizontal pan (native drag); we reclaim the plain wheel for
   zoom in the capture phase and add Y-axis drag-to-scroll. vis runs on a plain
   linear (compressed) axis, so all window ms here are already on-screen ms — a
   wheel tick scales the visible window uniformly regardless of folded ranges. */

export interface InteractionBounds {
  zoomMinMs: number;
  zoomMaxMs: number;
  panMinMs: number;
  panMaxMs: number;
}

const ZOOM_SPEED = 0.2;

/** @param root the element vis-timeline renders into. @returns detach fn */
export function attachInteractions(
  root: HTMLElement,
  timeline: any,
  bounds: InteractionBounds,
): () => void {
  const centerEl = (): HTMLElement | null =>
    root.querySelector(".vis-panel.vis-center") as HTMLElement | null;
  const scrollLaneEl = (): HTMLElement | null => {
    const center = centerEl();
    if (center && center.scrollHeight > center.clientHeight + 1) return center;
    return null;
  };

  // ---- vertical drag-to-scroll when lanes overflow ----
  let vDrag = false;
  let vStartY = 0;
  let vStartTop = 0;
  let vEl: HTMLElement | null = null;

  const onMouseDown = (ev: MouseEvent) => {
    if (ev.button !== 0) return;
    vEl = scrollLaneEl();
    if (!vEl) return;
    vDrag = true;
    vStartY = ev.clientY;
    vStartTop = vEl.scrollTop;
  };
  const onMouseMove = (ev: MouseEvent) => {
    if (!vDrag || !vEl) return;
    vEl.scrollTop = vStartTop - (ev.clientY - vStartY);
  };
  const onMouseUp = () => {
    vDrag = false;
    vEl = null;
  };

  // ---- plain-wheel zoom (cursor-anchored); Shift+wheel -> vis vertical scroll ----
  const onWheel = (ev: WheelEvent) => {
    if (ev.shiftKey) return;
    ev.preventDefault();
    ev.stopPropagation();

    const w = timeline.getWindow();
    const startC = w.start.valueOf();
    const endC = w.end.valueOf();
    const rangeC = endC - startC;
    if (rangeC <= 0) return;

    const center = root.querySelector(".vis-panel.vis-center") as HTMLElement | null;
    const rect = (center ?? root).getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    const pivotC = startC + ratio * rangeC;

    const panMinC = bounds.panMinMs;
    const panMaxC = bounds.panMaxMs;
    const zoomMaxC = panMaxC - panMinC;

    const factor = ev.deltaY < 0 ? 1 - ZOOM_SPEED : 1 + ZOOM_SPEED;
    let newRangeC = rangeC * factor;
    newRangeC = Math.max(bounds.zoomMinMs, Math.min(zoomMaxC, newRangeC));

    let sC = pivotC - ratio * newRangeC;
    let eC = sC + newRangeC;
    if (sC < panMinC) { sC = panMinC; eC = sC + newRangeC; }
    if (eC > panMaxC) { eC = panMaxC; sC = eC - newRangeC; }
    if (sC < panMinC) sC = panMinC;

    timeline.setWindow(new Date(sC), new Date(eC), { animation: false });
  };

  root.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  root.addEventListener("wheel", onWheel, { capture: true, passive: false });

  return () => {
    root.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    root.removeEventListener("wheel", onWheel, { capture: true } as any);
  };
}
