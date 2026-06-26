import { el, clear } from "./dom.js";
import { TimelineWidget, type Span, type SelectEventPayload } from "../timeline/index.js";
import { fetchTrace } from "../data/api.js";
import type { Conversation } from "../data/conversations.js";

// Controller that owns the timeline widget and drives the host's three canvas
// panels: the widget renders bare in the primary `timeline` panel, while this
// module renders the selected-span details into `block-info` and a lightweight
// overview into `timeline-miniature` from the fetched spans. The widget's own
// toolbar/infoPanel/miniature are all disabled — controls live in the View →
// Timeline menu (forwarded via window events), and info/miniature can only
// mount inside the widget; we wire its `select`/`rangechange` events to host
// panels instead.

const spanEndMs = (s: Span): number => {
  if (s.offset_end != null) return s.offset_end;
  if (s.offset_end_ms != null) return s.offset_end_ms;
  if (s.duration_ms != null) return s.offset_start_ms + s.duration_ms;
  return s.offset_start_ms;
};

const spanDurationMs = (s: Span): number =>
  s.duration_ms ?? Math.max(0, spanEndMs(s) - s.offset_start_ms);

const prettyType = (type: string): string =>
  type.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// m:ss.mmm — matches the widget info panel's clock format.
function formatClock(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(Math.round(ms));
  const m = Math.floor(abs / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const mmm = abs % 1000;
  return `${sign}${m}:${String(s).padStart(2, "0")}.${String(mmm).padStart(3, "0")}`;
}

export interface TimelinePanel {
  showTrace: (conversation: Conversation) => Promise<void>;
}

export function createTimelinePanel(
  timelineBody: HTMLElement,
  infoBody: HTMLElement,
  miniBody: HTMLElement,
): TimelinePanel {
  let widget: TimelineWidget | null = null;
  let requestSeq = 0;

  // Timeline controls live in the View → Timeline menu, not the widget's own
  // toolbar (which is disabled below). The menu broadcasts these commands; we
  // forward them to the live widget, or ignore them when none is loaded.
  window.addEventListener("timeline:zoom-in", () => widget?.zoomIn());
  window.addEventListener("timeline:zoom-out", () => widget?.zoomOut());
  window.addEventListener("timeline:fit", () => widget?.fit());
  window.addEventListener("timeline:expand-all", () => widget?.expandAll());
  window.addEventListener("timeline:collapse-all", () => widget?.collapseAll());
  window.addEventListener("timeline:shrink", (e) =>
    widget?.setShrinkLongBlocks((e as CustomEvent<{ on: boolean }>).detail.on),
  );
  window.addEventListener("timeline:shrink-params", (e) => {
    const { thresholdSec, collapseToSec } = (
      e as CustomEvent<{ thresholdSec: number; collapseToSec: number }>
    ).detail;
    widget?.setShrinkParams(thresholdSec, collapseToSec);
  });

  // ---- block-info panel -----------------------------------------------------
  const infoTitle = el("div", { class: "tl-info-title" });
  const infoSubtitle = el("div", { class: "tl-info-subtitle" });
  const infoContent = el("div", { class: "tl-info-content" });
  const resetInfo = () => {
    infoTitle.textContent = "No span selected";
    infoSubtitle.textContent = "";
    infoContent.textContent = "Click a span to see its details.";
  };
  const showInfo = (p: SelectEventPayload) => {
    const { type, span, merged, startMs, endMs } = p;
    const duration = span ? spanDurationMs(span) : Math.max(0, endMs - startMs);
    const timing = `${formatClock(startMs)} → ${formatClock(endMs)} · ${duration} ms`;
    if (merged || !span) {
      infoTitle.textContent = `${prettyType(type)} · merged`;
      infoSubtitle.textContent = `${timing} (union of overlapping spans)`;
      infoContent.textContent = "Merged coverage of overlapping spans in this section.";
      return;
    }
    infoTitle.textContent = span.title;
    infoSubtitle.textContent = `${prettyType(type)} · ${timing}`;
    infoContent.textContent = span.content?.trim() ? span.content : "(no content)";
  };
  clear(infoBody);
  infoBody.append(el("div", { class: "tl-info" }, [infoTitle, infoSubtitle, infoContent]));
  resetInfo();

  // ---- host miniature -------------------------------------------------------
  // Lanes by span type; bars positioned as a fraction of the total span. The
  // viewport rectangle tracks the widget's visible window via `rangechange`.
  // Fractions line up with the main axis while long-block shrink is off (the
  // default); enabling shrink would compress the axis but not this overview.
  const miniContent = el("div", { class: "tl-mini-content" });
  const miniWindow = el("div", { class: "tl-mini-window" });
  miniContent.append(miniWindow);
  clear(miniBody);
  miniBody.append(miniContent);

  let totalMs = 0;
  const pct = (ms: number) => (totalMs > 0 ? (ms / totalMs) * 100 : 0);

  const renderMiniature = (spans: Span[]) => {
    miniContent.querySelectorAll(".tl-mini-clip").forEach((n) => n.remove());
    const firstMs = spans.length ? Math.min(...spans.map((s) => s.offset_start_ms)) : 0;
    const lastMs = spans.length ? Math.max(...spans.map(spanEndMs)) : 0;
    totalMs = Math.max(0, lastMs - firstMs);

    // Lanes in first-seen type order.
    const laneIndex = new Map<string, number>();
    for (const s of spans) if (!laneIndex.has(s.type)) laneIndex.set(s.type, laneIndex.size);
    const laneCount = laneIndex.size || 1;
    const laneH = 100 / laneCount;

    for (const s of spans) {
      const left = pct(s.offset_start_ms - firstMs);
      const right = pct(spanEndMs(s) - firstMs);
      const li = laneIndex.get(s.type) ?? 0;
      const bar = el("div", { class: "tl-mini-clip" });
      bar.style.left = `${left}%`;
      bar.style.width = `${Math.max(0.4, right - left)}%`;
      bar.style.top = `${li * laneH}%`;
      bar.style.height = `${laneH}%`;
      miniContent.insertBefore(bar, miniWindow);
    }
    updateMiniWindow(firstMs, lastMs);
  };

  const updateMiniWindow = (startMs: number, endMs: number) => {
    const left = Math.max(0, pct(startMs));
    const right = Math.min(100, pct(endMs));
    miniWindow.style.left = `${left}%`;
    miniWindow.style.width = `${Math.max(0, right - left)}%`;
  };

  // ---- load + render --------------------------------------------------------
  const showTrace = async (conversation: Conversation): Promise<void> => {
    const seq = ++requestSeq;
    resetInfo();
    if (!widget) {
      clear(timelineBody);
      timelineBody.append(el("div", { class: "tl-state", text: "Loading…" }));
    }

    let spans: Span[];
    try {
      spans = await fetchTrace(conversation.framework, conversation.id);
    } catch {
      if (seq !== requestSeq) return;
      widget?.destroy();
      widget = null;
      clear(timelineBody);
      timelineBody.append(el("div", { class: "tl-state", text: "Cannot load trace." }));
      return;
    }
    if (seq !== requestSeq) return;

    if (spans.length === 0) {
      widget?.destroy();
      widget = null;
      clear(timelineBody);
      timelineBody.append(el("div", { class: "tl-state", text: "No spans in this session." }));
      miniContent.querySelectorAll(".tl-mini-clip").forEach((n) => n.remove());
      updateMiniWindow(0, 0);
      return;
    }

    if (!widget) {
      clear(timelineBody);
      widget = new TimelineWidget(timelineBody, {
        spans,
        features: { toolbar: false, infoPanel: false, miniature: false },
      });
      widget.on("select", showInfo);
      widget.on("rangechange", (r) => updateMiniWindow(r.startMs, r.endMs));
    } else {
      widget.setSpans(spans);
    }
    renderMiniature(spans);
  };

  return { showTrace };
}
