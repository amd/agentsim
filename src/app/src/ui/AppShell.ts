// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { el } from "./dom.js";
import { createMenuBar } from "./MenuBar.js";
import { createSidebar } from "./Sidebar.js";
import { createCanvas } from "./Canvas.js";
import { createNotifications } from "./Notifications.js";
import { openDataSourcesModal, handleDroppedPaths } from "./DataSourcesModal.js";
import { openAboutModal } from "./AboutModal.js";
import { menus } from "../data/menus.js";

// Top-level layout: controls bar on top, then sidebar + canvas.
// AppShell owns the toggleable panels and shows/hides them in response to the
// View-menu toggle events (lemonade-style lifted visibility state).
export function createAppShell(): HTMLElement {
  // Mount the notification surface before the sidebar so its first load's
  // failures/warnings have somewhere to land.
  const notifications = createNotifications();
  const sidebar = createSidebar();
  const canvas = createCanvas();

  const shell = el("div", { class: "app-shell" }, [
    createMenuBar(menus),
    el("div", { class: "app-body" }, [sidebar, canvas]),
    notifications,
  ]);

  const setVisible = (target: HTMLElement | null, visible: boolean) => {
    if (target) target.style.display = visible ? "" : "none";
  };

  const miniature = canvas.querySelector<HTMLElement>('[data-panel="timeline-miniature"]');

  const onToggle = (target: HTMLElement | null) => (e: Event) =>
    setVisible(target, (e as CustomEvent<{ visible: boolean }>).detail.visible);

  window.addEventListener("view:sessions", onToggle(sidebar));
  window.addEventListener("view:timeline-miniature", onToggle(miniature));

  window.addEventListener("file:manage-data-sources", () => openDataSourcesModal());
  window.addEventListener("help:about", () => openAboutModal());

  // Drag a file or folder anywhere in the window to stage it for import. The
  // webview delivers OS paths (not File objects), which feed the same
  // "pick framework → validate → add" flow as the Browse buttons.
  if ("__TAURI_INTERNALS__" in window) {
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") handleDroppedPaths(event.payload.paths);
    });
  }

  return shell;
}
