import { el } from "./dom.js";
import { createMenuBar } from "./MenuBar.js";
import { createSidebar } from "./Sidebar.js";
import { createCanvas } from "./Canvas.js";
import { openDataSourcesModal } from "./DataSourcesModal.js";
import { menus } from "../data/menus.js";

// Top-level layout: controls bar on top, then sidebar + canvas.
// AppShell owns the toggleable panels and shows/hides them in response to the
// View-menu toggle events (lemonade-style lifted visibility state).
export function createAppShell(): HTMLElement {
  const sidebar = createSidebar();
  const canvas = createCanvas();

  const shell = el("div", { class: "app-shell" }, [
    createMenuBar(menus),
    el("div", { class: "app-body" }, [sidebar, canvas]),
  ]);

  const setVisible = (target: HTMLElement | null, visible: boolean) => {
    if (target) target.style.display = visible ? "" : "none";
  };

  const blockInfo = canvas.querySelector<HTMLElement>('[data-panel="block-info"]');
  const miniature = canvas.querySelector<HTMLElement>('[data-panel="timeline-miniature"]');

  const onToggle = (target: HTMLElement | null) => (e: Event) =>
    setVisible(target, (e as CustomEvent<{ visible: boolean }>).detail.visible);

  window.addEventListener("view:sessions", onToggle(sidebar));
  window.addEventListener("view:block-info", onToggle(blockInfo));
  window.addEventListener("view:timeline-miniature", onToggle(miniature));

  window.addEventListener("file:manage-data-sources", () => openDataSourcesModal());

  return shell;
}
