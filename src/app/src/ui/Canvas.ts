import { el } from "./dom.js";

function section(title: string, placeholder: string): HTMLElement {
  return el("section", { class: "canvas-section" }, [
    el("div", { class: "canvas-section-header", text: title }),
    el("div", { class: "canvas-section-body", text: placeholder }),
  ]);
}

// Three stacked sections at 70% / 20% / 10% height (grid rows set in app.css).
export function createCanvas(): HTMLElement {
  return el("div", { class: "canvas" }, [
    section("Timeline", "Primary workspace (70%)."),
    section("Block Info", "Secondary panel (20%)."),
    section("Timeline Miniature", "Secondary panel (10%)."),
  ]);
}
