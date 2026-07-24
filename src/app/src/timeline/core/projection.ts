// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

import type { Span } from "../types";
import { type Interval, mergeIntervals } from "./intervals";
import { spanEndMs, spanStartMs } from "./spans";

/* The positioning engine and single owner of the collapse-aware coordinate math.
   It folds the middle of every over-threshold span into a "break" range, then maps
   real time <-> "compressed" (on-screen) time with the folded durations removed.
   Breaks are merged ONCE at construction; the transforms are plain scans over that
   pre-merged set (no per-call sorting).

   The widget pre-projects all item/axis positions through `toCompressed`, so vis
   sees a plain linear axis (no `hiddenDates`) and its native drag/zoom behave. The
   `breaks` set is still exposed for drawing the fold seam markers.

   All inputs/outputs are widget milliseconds (offsets from the trace origin). With
   collapse off, `breaks` is empty and every transform reduces to `ms - firstMs`. */

export interface Projection {
  /** merged break (folded) ranges, real (widget) ms; empty when collapse is off.
      Used only to draw the fold seam markers — not fed to vis. */
  readonly breaks: Interval[];
  readonly firstMs: number;
  /** on-screen width of the whole timeline, in compressed ms */
  readonly totalCompressedMs: number;
  /** real ms -> offset from `firstMs` with folded ranges removed (on-screen coord) */
  toCompressed(t: number): number;
  /** inverse of `toCompressed`; points inside a fold collapse to its visible seam */
  fromCompressed(c: number): number;
  /** real ms -> fraction [0..1] of the compressed timeline width */
  posFraction(ms: number): number;
  /** Move the window to begin at compressed fraction `f`, preserving its on-screen
      width and clamping to bounds. Returns the new window in real ms. */
  windowAtFraction(
    f: number,
    startMs: number,
    endMs: number,
  ): { startMs: number; endMs: number };
}

export interface ProjectionInput {
  spans: Span[];
  firstMs: number;
  spanMs: number;
  /** fold the middle of any span longer than `thresholdMs` */
  collapseLongBlocks: boolean;
  /** fold the middle of any empty gap (no span) longer than `thresholdMs` */
  collapseEmptyRegions: boolean;
  thresholdMs: number;
  collapseToMs: number;
}

/** The parts of `[lo, hi]` not covered by any of the (pre-merged) `occupied`
    ranges — i.e. the empty stretches a fold may safely hide. */
function freeSubintervals(lo: number, hi: number, occupied: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = lo;
  for (const [s, e] of occupied) {
    if (e <= lo || s >= hi) continue; // outside [lo, hi]
    const cs = Math.max(s, lo);
    if (cs > cursor) free.push([cursor, cs]);
    cursor = Math.max(cursor, Math.min(e, hi));
  }
  if (cursor < hi) free.push([cursor, hi]);
  return free;
}

/** The hidden (folded-away) middle of every span longer than the threshold.
    A long span is NOT folded as one block: any other span landing inside it
    (e.g. a checkpoint in a 30h batch) interrupts the fold, splitting the
    interior into free stretches. Each free stretch over the threshold folds
    its own middle — so an interrupting block stays visible, flanked by two
    independent shrinkages. */
function computeBreaks(
  spans: Span[],
  thresholdMs: number,
  collapseToMs: number,
): Interval[] {
  const ranges: Interval[] = [];
  const half = collapseToMs / 2;
  const all: Interval[] = spans.map((s) => [spanStartMs(s), spanEndMs(s)]);
  for (let i = 0; i < spans.length; i++) {
    const [startMs, endMs] = all[i];
    if (endMs - startMs <= thresholdMs) continue;
    // Spans landing inside this one become "occupied" regions the fold must
    // skip. A span that *contains* this one is excluded: folding here hides
    // nothing visible (the container is folding too), so a long child still
    // shrinks instead of staying full-size.
    const occupied = mergeIntervals(
      all.filter(
        (iv, j) => j !== i && !(iv[0] <= startMs && iv[1] >= endMs),
      ),
    );
    for (const [fs, fe] of freeSubintervals(startMs, endMs, occupied)) {
      if (fe - fs <= thresholdMs) continue;
      const hStart = fs + half;
      const hEnd = fe - half;
      if (hEnd > hStart) ranges.push([hStart, hEnd]);
    }
  }
  return ranges;
}

/** The hidden (folded-away) middle of every EMPTY gap longer than the threshold.
    Mirror of `computeBreaks` but operating on the stretches NOT covered by any
    span: the timeline's empty regions fold the same way long blocks do, keeping
    `collapseToMs` of each gap visible (half at each edge) and hiding the middle. */
function computeEmptyBreaks(
  spans: Span[],
  firstMs: number,
  spanMs: number,
  thresholdMs: number,
  collapseToMs: number,
): Interval[] {
  const ranges: Interval[] = [];
  const half = collapseToMs / 2;
  const occupied = mergeIntervals(spans.map((s) => [spanStartMs(s), spanEndMs(s)]));
  for (const [gs, ge] of freeSubintervals(firstMs, firstMs + spanMs, occupied)) {
    if (ge - gs <= thresholdMs) continue;
    const hStart = gs + half;
    const hEnd = ge - half;
    if (hEnd > hStart) ranges.push([hStart, hEnd]);
  }
  return ranges;
}

export function createProjection(input: ProjectionInput): Projection {
  const { firstMs, spanMs, collapseLongBlocks, collapseEmptyRegions, thresholdMs, collapseToMs } =
    input;
  // Both toggles feed the same fold machinery; collect each enabled source's
  // ranges and merge once so overlapping folds (e.g. a long block adjacent to a
  // long gap) become a single seam.
  const raw: Interval[] = [];
  if (collapseLongBlocks) raw.push(...computeBreaks(input.spans, thresholdMs, collapseToMs));
  if (collapseEmptyRegions)
    raw.push(...computeEmptyBreaks(input.spans, firstMs, spanMs, thresholdMs, collapseToMs));
  const breaks: Interval[] = mergeIntervals(raw);

  const toCompressed = (t: number): number => {
    let hidden = 0;
    for (const [s, e] of breaks) {
      if (t <= s) break;
      hidden += Math.min(t, e) - s;
    }
    return t - firstMs - hidden;
  };

  const fromCompressed = (c: number): number => {
    let real = firstMs;
    let comp = 0;
    for (const [s, e] of breaks) {
      const seg = s - real; // visible run before this hidden range
      if (c <= comp + seg) return real + (c - comp);
      comp += seg;
      real = e; // skip the hidden range (zero compressed width)
    }
    return real + (c - comp);
  };

  const totalCompressedMs = toCompressed(firstMs + spanMs);

  const posFraction = (ms: number): number =>
    totalCompressedMs > 0 ? toCompressed(ms) / totalCompressedMs : 0;

  const windowAtFraction = (f: number, startMs: number, endMs: number) => {
    const startC = toCompressed(startMs);
    const endC = toCompressed(endMs);
    const widthC = endC - startC;
    let sC = f * totalCompressedMs;
    if (sC + widthC > totalCompressedMs) sC = totalCompressedMs - widthC;
    if (sC < 0) sC = 0;
    return {
      startMs: fromCompressed(sC),
      endMs: fromCompressed(sC + widthC),
    };
  };

  return {
    breaks,
    firstMs,
    totalCompressedMs,
    toCompressed,
    fromCompressed,
    posFraction,
    windowAtFraction,
  };
}
