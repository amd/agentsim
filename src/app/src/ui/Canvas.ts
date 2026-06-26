import { el } from "./dom.js";
import { createTimelinePanel } from "./TimelinePanel.js";
import type { Conversation } from "../data/conversations.js";

function section(key: string, title: string): HTMLElement {
  return el("section", { class: "canvas-section", "data-panel": key }, [
    el("div", { class: "canvas-section-header", text: title }),
    el("div", { class: "canvas-section-body" }),
  ]);
}

// The timeline is the primary workspace, so it mounts bare — no section header
// or chrome — and fills the top of the canvas. Block Info and Timeline Miniature
// remain labeled sections below it. `data-panel` keys let AppShell toggle the
// two lower panels; the timeline carries one only to claim its flex ratio.
export function createCanvas(): HTMLElement {
  const timeline = el("div", { class: "canvas-timeline", "data-panel": "timeline" }, [
    el("div", { class: "tl-state", text: "Select a conversation to view its timeline." }),
  ]);
  const blockInfo = section("block-info", "Block Info");
  const miniature = section("timeline-miniature", "Timeline Miniature");

  const canvas = el("div", { class: "canvas" }, [timeline, blockInfo, miniature]);

  const body = (s: HTMLElement) => s.querySelector<HTMLElement>(".canvas-section-body")!;
  const panel = createTimelinePanel(timeline, body(blockInfo), body(miniature));

  window.addEventListener("conversation:select", (e) => {
    void panel.showTrace((e as CustomEvent<Conversation>).detail);
  });

  return canvas;
}
