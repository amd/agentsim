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
  miniContent: HTMLElement,
): TimelinePanel {
  let widget: TimelineWidget | null = null;
  let requestSeq = 0;

  // Live shrink state, kept in sync with the Timeline menu so a widget built for
  // a newly selected conversation starts with the same fold settings. Defaults
  // match the menu (on, fold blocks >600s down to 60s).
  let shrinkOn = true;
  let shrinkThresholdSec = 600;
  let shrinkToSec = 60;

  // Timeline controls live in the Timeline menu, not the widget's own toolbar
  // (which is disabled below). The menu broadcasts these commands; we forward
  // them to the live widget, or ignore them when none is loaded.
  window.addEventListener("timeline:zoom-in", () => widget?.zoomIn());
  window.addEventListener("timeline:zoom-out", () => widget?.zoomOut());
  window.addEventListener("timeline:fit", () => widget?.fit());
  window.addEventListener("timeline:expand-all", () => widget?.expandAll());
  window.addEventListener("timeline:collapse-all", () => widget?.collapseAll());
  window.addEventListener("timeline:shrink", (e) => {
    shrinkOn = (e as CustomEvent<{ on: boolean }>).detail.on;
    widget?.setShrinkLongBlocks(shrinkOn);
  });
  window.addEventListener("timeline:shrink-params", (e) => {
    const { thresholdSec, collapseToSec } = (
      e as CustomEvent<{ thresholdSec: number; collapseToSec: number }>
    ).detail;
    shrinkThresholdSec = thresholdSec;
    shrinkToSec = collapseToSec;
    widget?.setShrinkParams(thresholdSec, collapseToSec);
  });

  // ---- block-info popup -----------------------------------------------------
  // Clicking a span opens a modal (same overlay/chrome as Manage Data Sources)
  // with the selected span's details; only one is open at a time.
  let closeInfo: (() => void) | null = null;

  const showInfo = (p: SelectEventPayload) => {
    closeInfo?.();
    const { type, span, merged, startMs, endMs } = p;
    const duration = span ? spanDurationMs(span) : Math.max(0, endMs - startMs);
    const timing = `${formatClock(startMs)} → ${formatClock(endMs)} · ${duration} ms`;

    let title: string;
    let subtitle: string;
    let content: string;
    if (merged || !span) {
      title = `${prettyType(type)} · merged`;
      subtitle = `${timing} (union of overlapping spans)`;
      content = "Merged coverage of overlapping spans in this section.";
    } else {
      title = span.title;
      subtitle = `${prettyType(type)} · ${timing}`;
      content = span.content?.trim() ? span.content : "(no content)";
    }

    const closeBtn = el("button", {
      class: "lm-icon-btn ds-close",
      "aria-label": "Close",
      text: "✕",
    });
    const modal = el("div", { class: "ds-modal tl-info-modal" }, [
      el("div", { class: "ds-header" }, [
        el("h3", { class: "ds-title", text: "Block Info" }),
        closeBtn,
      ]),
      el("div", { class: "ds-body" }, [
        el("div", { class: "tl-info-title", text: title }),
        el("div", { class: "tl-info-subtitle", text: subtitle }),
        el("div", { class: "tl-info-content", text: content }),
      ]),
    ]);
    const overlay = el("div", { class: "ds-overlay" }, [modal]);

    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      closeInfo = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    closeInfo = close;

    document.body.append(overlay);
  };

  // ---- host miniature -------------------------------------------------------
  // Driven entirely by the widget so it matches the main axis exactly: lanes,
  // per-section palette colors, and collapse state come from `getMiniatureLanes`
  // (one union lane per collapsed section, one per title-row when expanded), and
  // every x-position runs through the widget's shrink-aware `posFraction`. We
  // re-render lanes on `layoutchange` (collapse/shrink/new spans) and move the
  // viewport rectangle on `rangechange`. The host passes the bare miniature
  // element directly (no section wrapper); we own its content class.
  miniContent.classList.add("tl-mini-content");
  const miniWindow = el("div", { class: "tl-mini-window" });
  clear(miniContent);
  miniContent.append(miniWindow);

  // Wheel over the miniature zooms the timeline, mirroring the main axis wheel
  // (interactions.ts: deltaY < 0 -> zoom in). Both steps are 20%, so the feel
  // matches. preventDefault stops the page from scrolling under the gesture.
  miniContent.addEventListener(
    "wheel",
    (e) => {
      if (!widget || e.shiftKey) return;
      e.preventDefault();
      if (e.deltaY < 0) widget.zoomIn();
      else widget.zoomOut();
    },
    { passive: false },
  );

  const renderMiniature = () => {
    miniContent.querySelectorAll(".tl-mini-clip").forEach((n) => n.remove());
    if (!widget) return;
    const lanes = widget.getMiniatureLanes();
    const laneH = lanes.length ? 100 / lanes.length : 100;
    lanes.forEach((lane, li) => {
      for (const [s, e] of lane.clips) {
        const left = widget!.posFraction(s) * 100;
        const right = widget!.posFraction(e) * 100;
        const bar = el("div", { class: "tl-mini-clip" });
        bar.style.left = `${left}%`;
        bar.style.width = `${Math.max(0.4, right - left)}%`;
        bar.style.top = `${li * laneH}%`;
        bar.style.height = `${laneH}%`;
        bar.style.backgroundColor = lane.color;
        miniContent.insertBefore(bar, miniWindow);
      }
    });
    updateMiniWindow();
  };

  // Drag the viewport rectangle to pan the timeline (horizontal only), mirroring
  // the widget's built-in Miniature: capture the start fraction on mousedown,
  // then pan to start + cursor delta as a fraction of the content width.
  let dragging = false;
  let dragStartX = 0;
  let dragStartFraction = 0;
  miniWindow.addEventListener("mousedown", (ev) => {
    if (!widget) return;
    ev.preventDefault();
    ev.stopPropagation();
    dragging = true;
    dragStartX = ev.clientX;
    dragStartFraction = widget.posFraction(widget.getWindow().startMs);
    miniWindow.classList.add("dragging");
  });
  window.addEventListener("mousemove", (ev) => {
    if (!dragging || !widget) return;
    const widthPx = miniContent.getBoundingClientRect().width;
    if (widthPx <= 0) return;
    const deltaFraction = (ev.clientX - dragStartX) / widthPx;
    widget.panToFraction(dragStartFraction + deltaFraction);
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    miniWindow.classList.remove("dragging");
  });

  const updateMiniWindow = () => {
    if (!widget) {
      miniWindow.style.width = "0%";
      return;
    }
    const { startMs, endMs } = widget.getWindow();
    const left = Math.max(0, widget.posFraction(startMs) * 100);
    const right = Math.min(100, widget.posFraction(endMs) * 100);
    miniWindow.style.left = `${left}%`;
    miniWindow.style.width = `${Math.max(0, right - left)}%`;
  };

  // ---- load + render --------------------------------------------------------
  const showTrace = async (conversation: Conversation): Promise<void> => {
    const seq = ++requestSeq;
    closeInfo?.();
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
      updateMiniWindow();
      return;
    }

    if (!widget) {
      clear(timelineBody);
      widget = new TimelineWidget(timelineBody, {
        spans,
        features: { toolbar: false, infoPanel: false, miniature: false },
        collapseLongBlocks: shrinkOn,
        collapseThresholdSec: shrinkThresholdSec,
        collapseToSec: shrinkToSec,
      });
      widget.on("select", showInfo);
      widget.on("rangechange", () => updateMiniWindow());
      widget.on("layoutchange", () => renderMiniature());
    } else {
      widget.setSpans(spans);
    }
    renderMiniature();
  };

  return { showTrace };
}
