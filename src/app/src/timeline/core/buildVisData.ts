import type { SelectEventPayload, Span } from "../types";
import { type Interval, unionForSpans } from "./intervals";
import {
  type Section,
  deriveSections,
  spanEndMs,
  spanStartMs,
} from "./spans";
import { msToDate } from "./time";

/* The single spans -> vis-timeline mapping. Spans are folded into sections/rows
   here; no intermediate public data tree. Items carry the `select` payload the
   widget echoes on click. No DOM access in this module. */

/** Default per-section colors (Lemonade label tokens). */
const DEFAULT_PALETTE = [
  "var(--label-reasoning)",
  "var(--label-coding)",
  "var(--label-embeddings)",
  "var(--label-vision)",
  "var(--label-hot)",
  "var(--label-reranking)",
  "var(--label-tool-calling)",
  "var(--label-custom)",
];

const sectionColor = (index: number): string =>
  DEFAULT_PALETTE[index % DEFAULT_PALETTE.length];

export const rowId = (type: string, title: string): string => `${type} ${title}`;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );

export interface VisItem {
  id: string;
  group: string;
  content: string;
  start: Date;
  end: Date;
  type: "range";
  style: string;
  className?: string;
  // metadata consumed by the widget (selection + info panel)
  _kind: "indiv" | "summary";
  _payload: SelectEventPayload;
}

/** Build every item once (individual spans + merged per-section summaries).
    A DataView filter shows summaries when collapsed, spans when expanded.

    Positions are emitted in COMPRESSED (on-screen) space via `toCompressed`: a
    folded long span's middle is removed, so its bar shrinks to the visible seam
    width. vis therefore sees a plain linear axis with no hidden dates — every
    interaction (drag/zoom/fit) works natively. The `_payload` keeps REAL ms for
    selection/info. With collapse off, `toCompressed` is `ms - firstMs`. */
export function buildItems(
  sections: Section[],
  toCompressed: (ms: number) => number,
): VisItem[] {
  const items: VisItem[] = [];
  let iid = 1;

  sections.forEach((section, gi) => {
    const color = sectionColor(gi);
    const style = `background-color:${color}; border-color:${color};`;

    // individual spans -> per-title rows
    for (const row of section.rows) {
      for (const span of row.spans) {
        const startMs = spanStartMs(span);
        const endMs = spanEndMs(span);
        items.push({
          id: `i${iid++}`,
          group: rowId(section.type, row.title),
          content: "",
          start: msToDate(toCompressed(startMs)),
          end: msToDate(toCompressed(endMs)),
          type: "range",
          style,
          _kind: "indiv",
          _payload: {
            type: section.type,
            title: row.title,
            span,
            merged: false,
            startMs,
            endMs,
          },
        });
      }
    }

    // merged union bars -> the section header row (shown when collapsed)
    unionForSpans(section.spans).forEach(([s, e], k) => {
      items.push({
        id: `s-${gi}-${k}`,
        group: section.type,
        content: "",
        start: msToDate(toCompressed(s)),
        end: msToDate(toCompressed(e)),
        type: "range",
        style,
        className: "summary",
        _kind: "summary",
        _payload: {
          type: section.type,
          title: null,
          span: null,
          merged: true,
          startMs: s,
          endMs: e,
        },
      });
    });
  });

  return items;
}

const sectionHeaderHtml = (section: Section, color: string, collapsed: boolean) =>
  `<span class="tlw-toggle">${collapsed ? "▸" : "▾"}</span>` +
  `<span class="tlw-swatch" style="background:${color}"></span>${escapeHtml(section.label)}`;

const rowLabelHtml = (title: string) =>
  `<span class="tlw-indent"></span>${escapeHtml(title)}`;

/** Build the timeline rows for the current collapse state (per-title rows only when expanded). */
export function buildGroups(
  sections: Section[],
  collapsed: Record<string, boolean>,
): any[] {
  const rows: any[] = [];
  sections.forEach((section, gi) => {
    const color = sectionColor(gi);
    rows.push({
      id: section.type,
      content: sectionHeaderHtml(section, color, collapsed[section.type]),
      order: gi * 1000,
    });
    // Per-title rows are ALWAYS emitted; collapse hides them via `visible` rather
    // than removing them from the dataset. Structural add/remove on every toggle
    // kept vis's redraw loop "resized" across frames, eventually pinning its
    // redrawCount at the cap and wedging collapse — flipping `visible` restacks
    // without churn so the loop converges.
    section.rows.forEach((row, li) => {
      rows.push({
        id: rowId(section.type, row.title),
        content: rowLabelHtml(row.title),
        order: gi * 1000 + (li + 1),
        visible: !collapsed[section.type],
      });
    });
  });
  return rows;
}

export interface MiniLane {
  color: string;
  clips: Interval[];
}

/** Lane model for the miniature: one union lane per collapsed section, one lane
    per title-row when expanded. Mirrors the main timeline's collapse state. */
export function miniatureLanes(
  sections: Section[],
  collapsed: Record<string, boolean>,
): MiniLane[] {
  const lanes: MiniLane[] = [];
  sections.forEach((section, gi) => {
    const color = sectionColor(gi);
    if (collapsed[section.type]) {
      lanes.push({ color, clips: unionForSpans(section.spans) });
    } else {
      for (const row of section.rows) {
        lanes.push({
          color,
          clips: row.spans.map((s) => [spanStartMs(s), spanEndMs(s)] as Interval),
        });
      }
    }
  });
  return lanes;
}

export { deriveSections };
export type { Section };
