/* ------------------------------------------------------------------ *
 * Public data model — the widget consumes a flat Span stream natively.
 * Sections are inferred from `type` (one section per unique type) and
 * one row is created per unique `title` within a section. All positions
 * are MILLISECONDS, the smallest unit; offsets are measured from the
 * earliest span (so the first span starts at 0).
 * ------------------------------------------------------------------ */

/** A single event in the trace. This is the host-facing contract. */
export interface Span {
  span_id: string;
  /** becomes a section (top-level row) */
  type: string;
  /** becomes a row within its section */
  title: string;
  content?: string;
  timestamp_start?: string;
  timestamp_end?: string;
  /** start position, milliseconds from the trace origin */
  offset_start_ms: number;
  /** end position, milliseconds. Source uses `offset_end`; `offset_end_ms` is also accepted. */
  offset_end?: number;
  offset_end_ms?: number;
  duration_ms?: number;
}

/** Opt-in built-in UI. Disable any of these to render them yourself from events. */
export interface TimelineFeatures {
  /** Fit / collapse-all / expand-all bar. Default: true. */
  toolbar?: boolean;
  /** Selected-span details panel. Default: true. */
  infoPanel?: boolean;
  /** Whole-timeline overview with a viewport indicator. Default: true. */
  miniature?: boolean;
  /** Convenience light/dark switch (flips `data-theme` on <html>). Default: false. */
  themeToggle?: boolean;
}

export interface TimelineWidgetOptions {
  /** The flat span stream to render. */
  spans: Span[];
  features?: TimelineFeatures;
  /** Whether sections start collapsed. Default: true. */
  initiallyCollapsed?: boolean;
  /** Formats break-seam time chips. Receives milliseconds. Default: hours-aware
      timecode (`hh:mm:ss` when the trace spans ≥1h, else `m:ss`). */
  formatTime?: (ms: number) => string;
  /** Smallest zoom-in window, in milliseconds. Default: 50. */
  zoomMinMs?: number;
  /** Initial visible span, in milliseconds. Default: min(span, 30000). */
  defaultWindowMs?: number;
  /** Compress any span longer than `collapseThresholdSec` down to `collapseToSec`. Default: false. */
  collapseLongBlocks?: boolean;
  /** Threshold in seconds; blocks longer than this are compressed. Default: 10. */
  collapseThresholdSec?: number;
  /** Rendered length in seconds for a compressed block. Default: 2. */
  collapseToSec?: number;
}

export interface SelectEventPayload {
  /** the section (span type) the selection belongs to */
  type: string;
  /** the row (span title); null when a merged/collapsed summary bar was clicked */
  title: string | null;
  /** the selected span; null for a merged summary */
  span: Span | null;
  merged: boolean;
  startMs: number;
  endMs: number;
}

export interface RangeChangeEventPayload {
  startMs: number;
  endMs: number;
}

export interface ToggleSectionEventPayload {
  type: string;
  collapsed: boolean;
}

/** Event name → payload map, used by the widget's typed emitter. */
export interface TimelineEventMap {
  select: SelectEventPayload;
  rangechange: RangeChangeEventPayload;
  togglesection: ToggleSectionEventPayload;
  /** Lanes/positions changed (collapse, shrink, or new spans) — re-read the
      miniature model. Emitted in addition to the more specific events. */
  layoutchange: void;
}
