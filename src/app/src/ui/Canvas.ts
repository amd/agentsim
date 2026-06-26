import { el } from "./dom.js";
import { createTimelinePanel } from "./TimelinePanel.js";
import type { Conversation } from "../data/conversations.js";

// The timeline (primary workspace) and the miniature both mount bare — no
// section header or chrome — so the widget and the overview render raw. Block
// details open in a popup (see TimelinePanel). `data-panel` keys let AppShell
// toggle the miniature; the timeline carries one only to claim its flex ratio.
export function createCanvas(): HTMLElement {
  const timeline = el("div", { class: "canvas-timeline", "data-panel": "timeline" }, [
    el("div", { class: "tl-state", text: "Select a conversation to view its timeline." }),
  ]);
  const miniature = el("div", { "data-panel": "timeline-miniature" });

  const canvas = el("div", { class: "canvas" }, [timeline, miniature]);

  const panel = createTimelinePanel(timeline, miniature);

  window.addEventListener("conversation:select", (e) => {
    void panel.showTrace((e as CustomEvent<Conversation>).detail);
  });

  return canvas;
}
