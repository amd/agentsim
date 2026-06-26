import { el } from "./dom.js";
import { createTimelinePanel } from "./TimelinePanel.js";
import type { Conversation } from "../data/conversations.js";

function section(key: string, title: string): HTMLElement {
  return el("section", { class: "canvas-section", "data-panel": key }, [
    el("div", { class: "canvas-section-header", text: title }),
    el("div", { class: "canvas-section-body" }),
  ]);
}

// The timeline (primary workspace) and the miniature both mount bare — no
// section header or chrome — so the widget and the overview render raw. Only
// Block Info remains a labeled section. `data-panel` keys let AppShell toggle
// the miniature; the timeline carries one only to claim its flex ratio.
export function createCanvas(): HTMLElement {
  const timeline = el("div", { class: "canvas-timeline", "data-panel": "timeline" }, [
    el("div", { class: "tl-state", text: "Select a conversation to view its timeline." }),
  ]);
  const blockInfo = section("block-info", "Block Info");
  const miniature = el("div", { "data-panel": "timeline-miniature" });

  const canvas = el("div", { class: "canvas" }, [timeline, blockInfo, miniature]);

  const body = (s: HTMLElement) => s.querySelector<HTMLElement>(".canvas-section-body")!;
  const panel = createTimelinePanel(timeline, body(blockInfo), miniature);

  window.addEventListener("conversation:select", (e) => {
    void panel.showTrace((e as CustomEvent<Conversation>).detail);
  });

  return canvas;
}
