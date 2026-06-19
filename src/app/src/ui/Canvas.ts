import { el } from "./dom.js";

function section(key: string, title: string, placeholder: string): HTMLElement {
  return el("section", { class: "canvas-section", "data-panel": key }, [
    el("div", { class: "canvas-section-header", text: title }),
    el("div", { class: "canvas-section-body", text: placeholder }),
  ]);
}

// Three stacked sections at 70% / 20% / 10% height (flex ratios set in app.css).
// `data-panel` keys let AppShell show/hide the toggleable panels.
export function createCanvas(): HTMLElement {
  return el("div", { class: "canvas" }, [
    section("timeline", "Timeline", "Primary workspace (70%)."),
    section("block-info", "Block Info", "Secondary panel (20%)."),
    section("timeline-miniature", "Timeline Miniature", "Secondary panel (10%)."),
  ]);
}
