import { el } from "./dom.js";
import { createTimelinePanel } from "./TimelinePanel.js";
import type { Conversation } from "../data/conversations.js";

// The timeline (primary workspace) and the miniature both mount bare — no
// section header or chrome — so the widget and the overview render raw. Block
// details render into a docked section under the miniature, shown only while a
// block is selected (it shrinks the timeline; hiding it gives the height back).
// `data-panel` keys let AppShell toggle the miniature; the timeline carries one
// only to claim its flex ratio.
export function createCanvas(): HTMLElement {
  const timeline = el("div", { class: "canvas-timeline", "data-panel": "timeline" }, [
    el("div", { class: "tl-state", text: "Select a conversation to view its timeline." }),
  ]);
  const miniature = el("div", { "data-panel": "timeline-miniature" });

  const infoBody = el("div", { class: "canvas-section-body" });
  const infoClose = el("button", {
    class: "lm-icon-btn tl-info-close",
    "aria-label": "Close",
    text: "✕",
  });
  const blockInfo = el(
    "section",
    { class: "canvas-section", "data-panel": "block-info" },
    [infoClose, infoBody],
  );
  blockInfo.style.display = "none";

  const canvas = el("div", { class: "canvas" }, [timeline, miniature, blockInfo]);

  const panel = createTimelinePanel(timeline, miniature, {
    body: infoBody,
    setVisible: (visible) => {
      blockInfo.style.display = visible ? "flex" : "none";
    },
  });
  infoClose.addEventListener("click", () => panel.hideInfo());

  window.addEventListener("conversation:select", (e) => {
    void panel.showTrace((e as CustomEvent<Conversation>).detail);
  });

  return canvas;
}
