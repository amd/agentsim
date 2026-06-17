import { el } from "./dom.js";

function section(title: string, placeholder: string): HTMLElement {
  return el("section", { class: "canvas-section" }, [
    el("div", { class: "canvas-section-header", text: title }),
    el("div", { class: "canvas-section-body", text: placeholder }),
  ]);
}

// Three stacked sections at 60% / 20% / 20% height (grid rows set in app.css).
export function createCanvas(): HTMLElement {
  return el("div", { class: "canvas" }, [
    section("Main", "Primary workspace (60%)."),
    section("Panel A", "Secondary panel (20%)."),
    section("Panel B", "Secondary panel (20%)."),
  ]);
}
