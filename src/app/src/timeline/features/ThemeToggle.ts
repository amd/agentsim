// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

export interface ThemeToggleHandle {
  el: HTMLElement;
  destroy: () => void;
}

/* Convenience light/dark switch. Theming is normally the host's responsibility
   (it owns `data-theme` on <html>); this just flips it for demos/standalone use. */
export function createThemeToggle(): ThemeToggleHandle {
  const el = document.createElement("button");
  el.className = "lm-btn lm-btn-ghost tlw-theme-toggle";

  const root = document.documentElement;
  const sync = () => {
    el.textContent = root.getAttribute("data-theme") === "light" ? "Dark" : "Light";
  };
  const onClick = () => {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    sync();
  };

  el.addEventListener("click", onClick);
  sync();

  return {
    el,
    destroy: () => el.remove(),
  };
}
