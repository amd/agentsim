import { el } from "./dom.js";
import { createTimelinePanel } from "./TimelinePanel.js";
import type { Conversation } from "../data/conversations.js";

function section(key: string, title: string, placeholder: string): HTMLElement {
  return el("section", { class: "canvas-section", "data-panel": key }, [
    el("div", { class: "canvas-section-header", text: title }),
    el("div", { class: "canvas-section-body", text: placeholder }),
  ]);
}

// Three stacked sections at 70% / 20% / 10% height (flex ratios set in app.css).
// `data-panel` keys let AppShell show/hide the toggleable panels. The timeline
// section hosts the widget; block-info and timeline-miniature are driven by the
// TimelinePanel controller in response to conversation selection.
export function createCanvas(): HTMLElement {
  const timeline = section("timeline", "Timeline", "Select a conversation to view its timeline.");
  const blockInfo = section("block-info", "Block Info", "");
  const miniature = section("timeline-miniature", "Timeline Miniature", "");

  const canvas = el("div", { class: "canvas" }, [timeline, blockInfo, miniature]);

  const body = (s: HTMLElement) => s.querySelector<HTMLElement>(".canvas-section-body")!;
  const panel = createTimelinePanel(body(timeline), body(blockInfo), body(miniature));

  window.addEventListener("conversation:select", (e) => {
    void panel.showTrace((e as CustomEvent<Conversation>).detail);
  });

  return canvas;
}
