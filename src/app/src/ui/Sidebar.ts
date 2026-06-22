import { el, clear } from "./dom.js";
import { createConversationBlock } from "./ConversationBlock.js";
import { sortByDateDesc, type Conversation } from "../data/conversations.js";
import { SECTIONS, sectionFor, startOfToday, type Section } from "../data/sections.js";
import { createFilterPanel, emptyFilters, matchesFilters, type Filters } from "./FilterPanel.js";

// Feather-style 24x24 stroke icons. Set via innerHTML because el() builds HTML
// nodes, not the SVG namespace.
const FILTER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>';
const SEARCH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

function iconButton(svg: string, label: string): HTMLButtonElement {
  const btn = el("button", { class: "lm-icon-btn", "aria-label": label, title: label });
  btn.innerHTML = svg;
  return btn;
}

// Conversation navigator: a title row with filter/search actions over a
// scrollable list grouped into date sections. The filter window lives in a
// popover opened from the filter icon; it owns the filter state and re-renders
// the list in place on change.
export function createSidebar(conversations: Conversation[]): HTMLElement {
  const list = el("div", { class: "conversation-list" });

  const renderList = (filters: Filters) => {
    const startToday = startOfToday();
    const filtered = conversations.filter((c) => matchesFilters(c, filters, startToday));
    const sorted = sortByDateDesc(filtered);

    clear(list);
    if (sorted.length === 0) {
      list.append(
        el("div", { class: "conversation-empty", text: "No conversations match." }),
      );
      return;
    }

    // Group the (already date-desc) list into date sections, newest first.
    const groups = new Map<Section, Conversation[]>();
    for (const c of sorted) {
      const s = sectionFor(c.date, startToday);
      const bucket = groups.get(s) ?? [];
      bucket.push(c);
      groups.set(s, bucket);
    }

    for (const s of SECTIONS) {
      const items = groups.get(s);
      if (!items) continue;
      list.append(el("div", { class: "conversation-section-header", text: s }));
      const showTime = s === "Today" || s === "Yesterday";
      for (const c of items) list.append(createConversationBlock(c, showTime));
    }
  };

  // Filter popover: the 4-section filter panel, revealed from the filter icon.
  // Anchored to a position:relative wrapper; click outside closes it.
  const filterBtn = iconButton(FILTER_SVG, "Filter");
  const popover = el("div", { class: "filter-popover" }, [
    createFilterPanel(conversations, renderList),
  ]);
  popover.style.display = "none";

  const closePopover = () => {
    popover.style.display = "none";
    filterBtn.classList.remove("active");
  };
  filterBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popover.style.display !== "none") closePopover();
    else {
      popover.style.display = "";
      filterBtn.classList.add("active");
    }
  });
  popover.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", closePopover);

  const filterWrap = el("div", { class: "sidebar-action-wrap" }, [filterBtn, popover]);

  // Search is a placeholder for future functionality.
  const searchBtn = iconButton(SEARCH_SVG, "Search");
  searchBtn.addEventListener("click", () => console.log("[sidebar] search (placeholder)"));

  const header = el("div", { class: "sidebar-header" }, [
    el("div", { class: "sidebar-header-row" }, [
      el("h3", { class: "sidebar-title", text: "Conversations" }),
      el("div", { class: "sidebar-actions" }, [filterWrap, searchBtn]),
    ]),
  ]);

  renderList(emptyFilters());

  return el("aside", { class: "sidebar" }, [header, list]);
}
