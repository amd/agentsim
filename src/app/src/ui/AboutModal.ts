// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

import { el } from "./dom.js";

// Small "About" window opened from Help > About. Reuses the shared overlay/modal
// styling (ds-overlay/ds-header/ds-close) so it matches the other dialogs.
export function openAboutModal(): void {
  // Guard against opening a second copy while one is already up.
  if (document.querySelector(".about-modal")) return;

  const closeBtn = el("button", {
    class: "lm-icon-btn ds-close", "aria-label": "Close", text: "✕",
  });

  const modal = el("div", { class: "ds-picker about-modal" }, [
    el("div", { class: "ds-header" }, [
      el("h3", { class: "ds-title", text: "About" }),
      closeBtn,
    ]),
    el("div", { class: "ds-picker-body about-body" }, [
      el("div", { class: "about-name", text: `AgentSim v${__APP_VERSION__}` }),
      el("div", { class: "about-line", text: "AMD open source software" }),
      el("div", { class: "about-line", text: "Copyright AMD 2026" }),
      el("a", {
        class: "about-link",
        href: "https://github.com/amd/agentsim",
        text: "github.com/amd/agentsim",
      }),
    ]),
  ]);

  const overlay = el("div", { class: "ds-overlay" }, [modal]);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  document.body.append(overlay);
}
