import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { el } from "./dom.js";
import type { Menu, MenuItem } from "../data/menus.js";
import darkIconUrl from "../../assets/icon/light.png";

const isTauri = (): boolean => "__TAURI_INTERNALS__" in window;

// Window-control glyphs, cloned 1:1 from reference/lemonade's TitleBar SVGs.
const ICON_MINIMIZE = `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="0" y="5" width="12" height="1" fill="currentColor"/></svg>`;
const ICON_MAXIMIZE = `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
const ICON_RESTORE = `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/><rect x="0.5" y="2.5" width="9" height="9" fill="black" stroke="currentColor" stroke-width="1"/></svg>`;
const ICON_CLOSE = `<svg width="12" height="12" viewBox="0 0 12 12"><path d="M 1,1 L 11,11 M 11,1 L 1,11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

// Minimize / maximize / close buttons that replace the native window frame.
// Only rendered inside Tauri; in browser dev the native chrome stays.
function createWindowControls(): HTMLElement {
  const fire = (cmd: string) => () => void invoke(cmd).catch((e) => console.warn(cmd, e));

  const button = (cls: string, title: string, svg: string, onClick: () => void): HTMLButtonElement => {
    const btn = el("button", {
      class: `menubar-btn ${cls}`,
      title,
      type: "button",
      "data-tauri-drag-region": "false",
    });
    btn.innerHTML = svg;
    btn.addEventListener("click", onClick);
    return btn;
  };

  const minimize = button("minimize", "Minimize", ICON_MINIMIZE, fire("minimize_window"));
  const maximize = button("maximize", "Maximize", ICON_MAXIMIZE, fire("maximize_window"));
  const close = button("close", "Close", ICON_CLOSE, fire("close_window"));

  // Window starts unmaximized; the host emits maximize-change on every resize.
  listen<boolean>("maximize-change", (e) => {
    maximize.innerHTML = e.payload ? ICON_RESTORE : ICON_MAXIMIZE;
    maximize.title = e.payload ? "Restore Down" : "Maximize";
  });

  return el("div", { class: "menubar-controls", "data-tauri-drag-region": "false" }, [
    minimize,
    maximize,
    close,
  ]);
}

// Controls bar: File / Tools / View / Help. Click a label to open its dropdown;
// only one is open at a time; clicking the label again or anywhere outside
// closes it.
export function createMenuBar(menus: Menu[]): HTMLElement {
  let openWrapper: HTMLElement | null = null;

  const close = () => {
    if (!openWrapper) return;
    openWrapper.querySelector(".menubar-item")?.classList.remove("active");
    openWrapper.querySelector(".menubar-dropdown")?.remove();
    openWrapper = null;
  };

  // Gray out a work-in-progress item: disabled styling, a hover tooltip, and
  // clicks swallowed so the action never fires (and the menu stays open).
  const markWip = (item: HTMLElement): void => {
    item.classList.add("disabled", "wip-tip");
    item.dataset.wip = "Work in progress — coming soon";
    item.addEventListener("click", (e) => e.stopPropagation());
  };

  // Render one dropdown item.
  const renderItem = (option: MenuItem): HTMLElement => {
    if (option === "divider") return el("div", { class: "sep" });

    // Section header: a non-interactive caption for the items beneath it.
    if ("header" in option) return el("div", { class: "menu-header", text: option.header });

    // Checkbox: leading "✓" when checked; click toggles and closes the menu.
    if ("onToggle" in option) {
      const item = el("div", { class: "item" }, [
        el("span", { text: `${option.checked ? "✓ " : ""}${option.label}` }),
        option.shortcut ? el("span", { class: "shortcut", text: option.shortcut }) : null,
      ]);
      if (option.wip) markWip(item);
      else
        item.addEventListener("click", () => {
          option.onToggle(!option.checked);
          close();
        });
      return item;
    }

    // Plain selectable option.
    const item = el("div", { class: "item" }, [
      el("span", { text: option.label }),
      option.shortcut ? el("span", { class: "shortcut", text: option.shortcut }) : null,
    ]);
    if (option.wip) markWip(item);
    else
      item.addEventListener("click", () => {
        option.onSelect();
        close();
      });
    return item;
  };

  const wrappers = menus.map((menu) => {
    const label = el("span", { class: "menubar-item", text: menu.label });
    const wrapper = el("div", { class: "menubar-item-wrapper", "data-tauri-drag-region": "false" }, [label]);

    const open = () => {
      const dropdown = el("div", { class: "menubar-dropdown" }, [
        el("div", { class: "lm-menu" }, menu.options.map(renderItem)),
      ]);
      label.classList.add("active");
      wrapper.append(dropdown);
      openWrapper = wrapper;
    };

    label.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = openWrapper === wrapper;
      close();
      if (!wasOpen) open();
    });

    return wrapper;
  });

  // Click anywhere outside an open menu closes it.
  document.addEventListener("click", () => close());

  const icon = el("img", {
    class: "menubar-icon",
    src: darkIconUrl,
    alt: "",
    "data-tauri-drag-region": "false",
  });
  const children: (HTMLElement | null)[] = [icon, ...wrappers];
  if (isTauri()) children.push(createWindowControls());
  return el("div", { class: "menubar", "data-tauri-drag-region": "" }, children);
}
