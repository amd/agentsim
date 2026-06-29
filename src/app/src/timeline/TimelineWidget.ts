import { Timeline, DataSet, DataView } from "vis-timeline/standalone";

import {
  type Section,
  buildGroups,
  buildItems,
  deriveSections,
  miniatureLanes,
  type MiniLane,
  type VisItem,
} from "./core/buildVisData";
import { dateToMs, formatAxisLabel, formatTimecode, msToDate } from "./core/time";
import { type Projection, createProjection } from "./core/projection";
import { spanEndMs, spanStartMs } from "./core/spans";
import { Emitter } from "./emitter";
import { attachInteractions, type InteractionBounds } from "./interactions";
import { createBreakMarkers, type BreakMarkersHandle } from "./features/BreakMarkers";
import { createInfoPanel, type InfoPanelHandle } from "./features/InfoPanel";
import { createMiniature, type MiniatureHandle } from "./features/Miniature";
import { createThemeToggle, type ThemeToggleHandle } from "./features/ThemeToggle";
import { createToolbar, type ToolbarHandle } from "./features/Toolbar";
import type {
  SelectEventPayload,
  Span,
  TimelineEventMap,
  TimelineWidgetOptions,
} from "./types";

/**
 * Framework-free, read-only timeline widget. It consumes a flat Span stream
 * natively — sections are inferred from `type`, rows from `title`:
 *
 *   const w = new TimelineWidget(el, { spans, features: { miniature: true } });
 *   w.on("select", (p) => ...);
 *   w.collapseAll(); w.fit(); w.setSpans(next); w.destroy();
 */
export class TimelineWidget {
  private readonly root: HTMLElement;
  private readonly emitter = new Emitter<TimelineEventMap>();
  private readonly fmt: (ms: number) => string;

  private spans: Span[];
  private sections: Section[];
  private collapsed: Record<string, boolean> = {};

  private timelineSection!: HTMLDivElement;
  private timelineEl!: HTMLDivElement;
  private timeline!: any;
  private items!: any;
  private view!: any;
  private groups!: any;

  private firstMs = 0;
  private spanMs = 0;
  private lastScale = "";
  private readonly zoomMinMs: number;
  private readonly defaultWindowMs?: number;
  private collapseLongBlocks: boolean;
  private collapseEmptyRegions: boolean;
  private collapseThresholdMs: number;
  private collapseToMs: number;

  private toolbar?: ToolbarHandle;
  private themeToggle?: ThemeToggleHandle;
  private infoPanel?: InfoPanelHandle;
  private miniature?: MiniatureHandle;
  private breakMarkers?: BreakMarkersHandle;

  private detachInteractions: () => void = () => {};
  private interactionBounds!: InteractionBounds;
  private projection!: Projection;

  /** Real ms -> on-screen ms; reads the live projection, so it stays correct
      across rebuilds. Passed to `buildItems` (items live in compressed space). */
  private readonly toCompressed = (ms: number): number =>
    this.projection.toCompressed(ms);

  constructor(container: HTMLElement, options: TimelineWidgetOptions) {
    this.root = container;
    this.root.classList.add("tlw");
    this.spans = options.spans ?? [];
    this.sections = deriveSections(this.spans);
    // Seam chips share the axis structure: hours iff the whole trace spans an
    // hour+, never tenths (chips mark whole-second fold boundaries). Evaluated
    // lazily so `spanMs` is set by the time a chip renders.
    this.fmt =
      options.formatTime ??
      ((ms) => formatTimecode(ms, { hours: this.spanMs > 3600000, tenths: false }));
    // Finest tier is m:ss.d: a ~1s visible window keeps vis on 0.1s ticks.
    this.zoomMinMs = options.zoomMinMs ?? 1000;
    this.defaultWindowMs = options.defaultWindowMs;
    this.collapseLongBlocks = options.collapseLongBlocks ?? false;
    this.collapseEmptyRegions = options.collapseEmptyRegions ?? false;
    this.collapseThresholdMs = (options.collapseThresholdSec ?? 10) * 1000;
    this.collapseToMs = (options.collapseToSec ?? 2) * 1000;

    const features = {
      toolbar: true,
      infoPanel: true,
      miniature: true,
      themeToggle: false,
      ...(options.features ?? {}),
    };
    const initiallyCollapsed = options.initiallyCollapsed ?? true;
    this.resetCollapseState(initiallyCollapsed);
    this.computeBounds();
    this.rebuildProjection();

    // ---- toolbar (top) ----
    if (features.toolbar) {
      this.toolbar = createToolbar(
        {
          fit: () => this.fit(),
          collapseAll: () => this.collapseAll(),
          expandAll: () => this.expandAll(),
          zoomIn: () => this.zoomIn(),
          zoomOut: () => this.zoomOut(),
          setShrinkLongBlocks: (on) => this.setShrinkLongBlocks(on),
          setShrinkParams: (thresholdSec, collapseToSec) =>
            this.setShrinkParams(thresholdSec, collapseToSec),
        },
        {
          shrinkLongBlocks: this.collapseLongBlocks,
          shrinkThresholdSec: this.collapseThresholdMs / 1000,
          shrinkToSec: this.collapseToMs / 1000,
        },
      );
      if (features.themeToggle) {
        this.themeToggle = createThemeToggle();
        this.toolbar.el.appendChild(this.themeToggle.el);
      }
      this.root.appendChild(this.toolbar.el);
    }

    // ---- timeline (fills remaining space) ----
    this.timelineSection = document.createElement("div");
    this.timelineSection.className = "tlw-timeline";
    this.timelineEl = document.createElement("div");
    this.timelineEl.className = "tlw-timeline-panel";
    this.timelineSection.appendChild(this.timelineEl);
    this.root.appendChild(this.timelineSection);

    // ---- info panel ----
    if (features.infoPanel) {
      this.infoPanel = createInfoPanel();
      this.root.appendChild(this.infoPanel.el);
    }

    // ---- miniature (bottom) ----
    if (features.miniature) {
      this.miniature = createMiniature({
        getLanes: () => miniatureLanes(this.sections, this.collapsed),
        posFraction: (ms) => this.projection.posFraction(ms),
        getWindow: () => this.windowMs(),
        panToStartFraction: (f) => this.panToStartFraction(f),
      });
      this.root.appendChild(this.miniature.el);
    }

    this.buildTimeline();
  }

  // ---------------------------------------------------------------- public API

  on<K extends keyof TimelineEventMap>(
    event: K,
    cb: (payload: TimelineEventMap[K]) => void,
  ): () => void {
    return this.emitter.on(event, cb);
  }

  /** Lane model for an external miniature, reflecting the live collapse state:
      one union lane per collapsed section, one lane per title-row when expanded.
      Same data the built-in miniature renders. Pair with `posFraction` for x. */
  getMiniatureLanes(): MiniLane[] {
    return miniatureLanes(this.sections, this.collapsed);
  }

  /** Real ms → fraction [0..1] of the compressed (on-screen) width. Shrink-aware
      (folded ranges removed), so it lines up with the rendered axis and items. */
  posFraction(ms: number): number {
    return this.projection.posFraction(ms);
  }

  /** Current visible window in REAL ms (the public coordinate). */
  getWindow(): { startMs: number; endMs: number } {
    return this.windowMs();
  }

  /** Pan so the visible window begins at compressed fraction `f`, preserving its
      on-screen width. Lets an external miniature drive drag-to-pan, same as the
      built-in one. */
  panToFraction(f: number): void {
    this.panToStartFraction(f);
  }

  private emitLayout(): void {
    this.emitter.emit("layoutchange", undefined);
  }

  fit(): void {
    // The whole timeline in compressed space is [0, totalCompressedMs].
    this.timeline.setWindow(
      msToDate(0),
      msToDate(this.projection.totalCompressedMs),
      { animation: false },
    );
  }

  /** Zoom in by 20%, centered on the current window; respects `zoomMinMs`. */
  zoomIn(): void {
    this.zoomByFactor(0.8);
  }

  /** Zoom out by 20%, centered on the current window; respects the full span. */
  zoomOut(): void {
    this.zoomByFactor(1.2);
  }

  /** Scale the visible window by `factor` about its center, in compressed
      (on-screen) space — same math as the wheel zoom, so folded ranges don't
      distort the step. vis's native zoomIn/zoomOut work in real time and explode
      across collapsed blocks. */
  private zoomByFactor(factor: number): void {
    // vis runs in compressed space, so its window is already compressed ms.
    const w = this.timeline.getWindow();
    const startC = dateToMs(w.start.valueOf());
    const endC = dateToMs(w.end.valueOf());
    const rangeC = endC - startC;
    if (rangeC <= 0) return;

    const total = this.projection.totalCompressedMs;
    const centerC = startC + rangeC / 2;
    let newRangeC = rangeC * factor;
    newRangeC = Math.max(this.interactionBounds.zoomMinMs, Math.min(total, newRangeC));

    let sC = centerC - newRangeC / 2;
    let eC = sC + newRangeC;
    if (sC < 0) { sC = 0; eC = sC + newRangeC; }
    if (eC > total) { eC = total; sC = eC - newRangeC; }
    if (sC < 0) sC = 0;

    this.timeline.setWindow(msToDate(sC), msToDate(eC), { animation: false });
  }

  /** Hard stop at the decimals (0.1s) tier: the smallest window vis can show
      without subdividing minor ticks below 100ms.

      vis chooses the smallest "nice" step strictly greater than
      `minimumStep = (range / width) * minorCharWidth * maxMinorChars`. The 50ms
      step is rejected once `minimumStep >= 50`, leaving 100ms as the finest tick.
      So the minimum visible range is `50 * width / (minorCharWidth * maxMinorChars)`.
      Recomputed from live metrics because it depends on panel width + font. */
  private refreshZoomFloor(): void {
    if (!this.interactionBounds) return;
    const width = this.timeline?.body?.domProps?.center?.width || 0;
    const charW = this.timeline?.timeAxis?.props?.minorCharWidth || 0;
    const maxChars = this.timeline?.options?.maxMinorChars || 7;
    if (width <= 0 || charW <= 0) return;
    // Compute-only: we own every zoom path (wheel + buttons both clamp against
    // interactionBounds.zoomMinMs), so this must NOT call setOptions — doing so
    // from the `changed` handler would redraw -> re-emit `changed` -> loop.
    const floor = Math.ceil((50 * width) / (charW * maxChars)) + 1;
    const cap = this.projection.totalCompressedMs || floor;
    this.interactionBounds.zoomMinMs = Math.min(cap, Math.max(this.zoomMinMs, floor));
  }

  /** Tag every minor axis label with a `title` revealing the active format
      (e.g. `hh:mm:ss`), so hovering a tick explains how to read it. The shape
      is uniform across the window: hours come from the total span, the `.d`
      tenths field from sub-second (`millisecond`) ticks. */
  private updateLabelHints(): void {
    const hint =
      (this.spanMs > 3600000 ? "hh:mm:ss" : "m:ss") +
      (this.lastScale === "millisecond" ? ".d" : "");
    const labels = this.timelineEl.querySelectorAll(
      ".vis-time-axis .vis-text:not(.vis-major)",
    );
    labels.forEach((el) => el.setAttribute("title", hint));
  }

  /** Turn the long-block compression on/off at runtime (toolbar toggle). */
  setShrinkLongBlocks(on: boolean): void {
    if (this.collapseLongBlocks === on) return;
    this.collapseLongBlocks = on;
    this.applyShrink();
  }

  /** Turn the empty-region compression on/off at runtime (toolbar toggle). Folds
      empty gaps with the same threshold/to params as long-block shrink. */
  setCollapseEmptyRegions(on: boolean): void {
    if (this.collapseEmptyRegions === on) return;
    this.collapseEmptyRegions = on;
    this.applyShrink();
  }

  /** Update the fold thresholds at runtime (toolbar fields), shared by both the
      long-block and empty-region folds. `thresholdSec` is the minimum block/gap
      length that gets folded; `collapseToSec` is how much of each folded stretch
      stays visible. Re-renders only when at least one fold is on. */
  setShrinkParams(thresholdSec: number, collapseToSec: number): void {
    this.collapseThresholdMs = Math.max(0, thresholdSec) * 1000;
    this.collapseToMs = Math.max(0, collapseToSec) * 1000;
    if (this.collapseLongBlocks || this.collapseEmptyRegions) this.applyShrink();
  }

  /** Rebuild the projection from the current shrink config and re-render every
      coordinate-dependent layer (items, bounds, miniature, seam markers). */
  private applyShrink(): void {
    this.rebuildProjection();
    this.items.clear();
    this.items.add(buildItems(this.sections, this.toCompressed) as VisItem[]);
    this.view.refresh();
    const total = this.projection.totalCompressedMs;
    this.timeline.setOptions({
      zoomMax: total,
      min: msToDate(0),
      max: msToDate(total),
    });
    this.syncInteractionBounds(total);
    this.fit();
    this.miniature?.renderLanes();
    this.miniature?.updateWindow();
    this.breakMarkers?.render();
    this.emitLayout();
  }

  /** Point the pan/zoom clamps at the current compressed extent `[0, total]`. */
  private syncInteractionBounds(total: number): void {
    this.interactionBounds.zoomMaxMs = total;
    this.interactionBounds.panMinMs = msToDate(0).getTime();
    this.interactionBounds.panMaxMs = msToDate(total).getTime();
  }

  collapseAll(): void {
    this.setAllCollapsed(true);
  }

  expandAll(): void {
    this.setAllCollapsed(false);
  }

  /** Toggle a single section by its `type`. */
  toggleSection(type: string): void {
    if (!(type in this.collapsed)) return;
    this.collapsed[type] = !this.collapsed[type];
    this.renderGroups();
    this.view.refresh();
    this.miniature?.renderLanes();
    this.emitter.emit("togglesection", {
      type,
      collapsed: this.collapsed[type],
    });
    this.emitLayout();
  }

  /** Replace the span stream and re-render in place. */
  setSpans(spans: Span[]): void {
    this.spans = spans;
    this.sections = deriveSections(this.spans);
    this.resetCollapseState(this.allCollapsed());
    this.computeBounds();
    this.rebuildProjection();
    this.items.clear();
    this.items.add(buildItems(this.sections, this.toCompressed) as VisItem[]);
    this.renderGroups();
    this.view.refresh();
    this.timeline.setOptions(this.rangeOptions());
    this.syncInteractionBounds(this.projection.totalCompressedMs);
    this.miniature?.renderLanes();
    this.miniature?.updateWindow();
    this.breakMarkers?.render();
    this.infoPanel?.reset();
    this.emitLayout();
  }

  destroy(): void {
    this.detachInteractions();
    this.emitter.clear();
    this.timeline.destroy();
    this.toolbar?.destroy();
    this.infoPanel?.destroy();
    this.miniature?.destroy();
    this.breakMarkers?.destroy();
    this.timelineSection.remove();
    this.root.classList.remove("tlw");
  }

  // ------------------------------------------------------------- internal init

  private buildTimeline(): void {
    this.items = new DataSet(
      buildItems(this.sections, this.toCompressed) as VisItem[],
    );
    this.view = new DataView(this.items, {
      filter: (item: any) =>
        item._kind === "summary"
          ? this.collapsed[item._payload.type]
          : !this.collapsed[item._payload.type],
    });
    this.groups = new DataSet(buildGroups(this.sections, this.collapsed));

    this.timeline = new Timeline(
      this.timelineEl,
      this.view as any,
      this.groups as any,
      {
        editable: false,
        selectable: true,
        stack: false,
        groupOrder: "order",
        orientation: { axis: "top", item: "top" },
        margin: { item: { horizontal: 0, vertical: 6 } },
        showCurrentTime: false,
        maxHeight: "100%",
        verticalScroll: true,
        format: {
          // vis dates are compressed ms; map back to real time for the label.
          // A folded range collapses to one seam x; suppress any tick that lands
          // in it so no axis label sits on the red break line. Structure is fixed
          // by total span (hh:mm:ss vs m:ss); the `.d` tenths tier is added when
          // vis's minor-tick `scale` reaches sub-second.
          minorLabels: (date: Date, scale: string) => {
            this.lastScale = scale;
            const realMs = this.projection.fromCompressed(dateToMs(date.valueOf()));
            for (const [s, e] of this.projection.breaks) {
              if (realMs >= s && realMs < e) return "";
            }
            return formatAxisLabel(realMs, scale, this.spanMs > 3600000);
          },
          majorLabels: () => "",
        },
        ...this.rangeOptions(),
      } as any,
    );

    // selection -> info panel + event
    this.timeline.on("click", (props: any) => {
      if (props.item) {
        const item = this.items.get(props.item) as VisItem | null;
        if (item) {
          const payload: SelectEventPayload = item._payload;
          this.infoPanel?.show(payload);
          this.emitter.emit("select", payload);
        }
        return;
      }
      if (props.what === "group-label") this.toggleSection(props.group as string);
    });

    // window sync -> miniature + break markers + event
    const onRange = () => {
      const w = this.windowMs();
      this.miniature?.updateWindow();
      this.breakMarkers?.reposition();
      this.emitter.emit("rangechange", {
        startMs: w.startMs,
        endMs: w.endMs,
      });
    };
    this.timeline.on("rangechange", onRange);
    this.timeline.on("rangechanged", onRange);

    // Layout/metrics can change (resize, first paint); recompute the zoom-in
    // floor so the hard stop at 0.1s ticks tracks the current panel width.
    this.timeline.on("changed", () => {
      this.refreshZoomFloor();
      this.updateLabelHints();
    });

    const total = this.projection.totalCompressedMs;
    this.interactionBounds = {
      zoomMinMs: this.zoomMinMs,
      zoomMaxMs: total,
      panMinMs: msToDate(0).getTime(),
      panMaxMs: msToDate(total).getTime(),
    };
    // vis now runs on a plain linear (compressed) axis, so interactions need no
    // coordinate bridge — identity coords (the default) are correct.
    this.detachInteractions = attachInteractions(
      this.timelineEl,
      this.timeline,
      this.interactionBounds,
    );

    this.breakMarkers = createBreakMarkers({
      root: this.timelineEl,
      getBreaks: () => this.projection.breaks,
      toScreen: (ms) =>
        this.timeline.body.util.toScreen(msToDate(this.projection.toCompressed(ms))),
      fmt: (ms) => this.fmt(ms),
    });
    this.breakMarkers.render();

    this.miniature?.renderLanes();
    this.miniature?.updateWindow();
  }

  // ------------------------------------------------------------ internal state

  private resetCollapseState(collapsed: boolean): void {
    this.collapsed = {};
    for (const s of this.sections) this.collapsed[s.type] = collapsed;
  }

  private allCollapsed(): boolean {
    const vals = Object.values(this.collapsed);
    return vals.length ? vals.every(Boolean) : true;
  }

  private computeBounds(): void {
    const starts: number[] = [];
    const ends: number[] = [];
    for (const span of this.spans) {
      starts.push(spanStartMs(span));
      ends.push(spanEndMs(span));
    }
    this.firstMs = starts.length ? Math.min(...starts) : 0;
    const lastMs = ends.length ? Math.max(...ends) : 0;
    this.spanMs = Math.max(0, lastMs - this.firstMs);
  }

  /** Rebuild the positioning engine from the current spans/bounds/collapse options.
      Call after `computeBounds()` whenever the data or collapse state changes. */
  private rebuildProjection(): void {
    this.projection = createProjection({
      spans: this.spans,
      firstMs: this.firstMs,
      spanMs: this.spanMs,
      collapseLongBlocks: this.collapseLongBlocks,
      collapseEmptyRegions: this.collapseEmptyRegions,
      thresholdMs: this.collapseThresholdMs,
      collapseToMs: this.collapseToMs,
    });
  }

  private rangeOptions() {
    // All bounds are in compressed (on-screen) ms: the axis starts at 0.
    const total = this.projection.totalCompressedMs;
    const defaultWindow = this.defaultWindowMs ?? Math.min(this.spanMs, 30000);
    return {
      zoomMin: this.zoomMinMs,
      zoomMax: total,
      min: msToDate(0),
      max: msToDate(total),
      start: msToDate(0),
      end: msToDate(Math.min(defaultWindow, total)),
    };
  }

  /** Pan so the visible window begins at compressed fraction `f`, preserving its
      on-screen width and clamping to bounds. The engine keeps the window the same
      visible size as it crosses folded ranges. */
  private panToStartFraction(f: number): void {
    const { startMs, endMs } = this.windowMs();
    const next = this.projection.windowAtFraction(f, startMs, endMs);
    // windowAtFraction returns real ms; vis runs in compressed space.
    this.timeline.setWindow(
      msToDate(this.projection.toCompressed(next.startMs)),
      msToDate(this.projection.toCompressed(next.endMs)),
      { animation: false },
    );
  }

  /** Current visible window in REAL ms (the public/feature-facing coordinate).
      vis stores compressed ms, so map each edge back through `fromCompressed`. */
  private windowMs(): { startMs: number; endMs: number } {
    const w = this.timeline.getWindow();
    return {
      startMs: this.projection.fromCompressed(dateToMs(w.start.valueOf())),
      endMs: this.projection.fromCompressed(dateToMs(w.end.valueOf())),
    };
  }

  private renderGroups(): void {
    const rows = buildGroups(this.sections, this.collapsed);
    this.groups.update(rows);
    const keep = new Set(rows.map((r) => r.id));
    const remove = (this.groups.getIds() as string[]).filter((id) => !keep.has(id));
    if (remove.length) this.groups.remove(remove);
  }

  private setAllCollapsed(state: boolean): void {
    for (const s of this.sections) this.collapsed[s.type] = state;
    this.renderGroups();
    this.view.refresh();
    this.miniature?.renderLanes();
    this.emitLayout();
  }
}
