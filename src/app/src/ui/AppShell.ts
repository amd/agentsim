import { el } from "./dom.js";
import { createMenuBar } from "./MenuBar.js";
import { createSidebar } from "./Sidebar.js";
import { createCanvas } from "./Canvas.js";
import { menus } from "../data/menus.js";
import { conversations } from "../data/conversations.js";

// Top-level layout: controls bar on top, then sidebar + canvas.
export function createAppShell(): HTMLElement {
  return el("div", { class: "app-shell" }, [
    createMenuBar(menus),
    el("div", { class: "app-body" }, [
      createSidebar(conversations),
      createCanvas(),
    ]),
  ]);
}
