import { el } from "./dom.js";
import type { Menu, MenuItem } from "../data/menus.js";

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
    item.addEventListener("click", () => {
      option.onSelect();
      close();
    });
    return item;
  };

  const wrappers = menus.map((menu) => {
    const label = el("span", { class: "menubar-item", text: menu.label });
    const wrapper = el("div", { class: "menubar-item-wrapper" }, [label]);

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

  return el("div", { class: "menubar" }, wrappers);
}
