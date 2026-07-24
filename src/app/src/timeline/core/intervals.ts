// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

import type { Span } from "../types";
import { spanEndMs, spanStartMs } from "./spans";

export type Interval = [number, number];

/** Merge overlapping/touching intervals into a minimal set of unions. */
export function mergeIntervals(ivs: Interval[]): Interval[] {
  if (!ivs.length) return [];
  const sorted = ivs.slice().sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [sorted[0].slice() as Interval];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1]) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push(sorted[i].slice() as Interval);
  }
  return out;
}

/** The merged coverage of a set of spans (a section's collapsed "union" bars). */
export function unionForSpans(spans: Span[]): Interval[] {
  return mergeIntervals(spans.map((s) => [spanStartMs(s), spanEndMs(s)] as Interval));
}
