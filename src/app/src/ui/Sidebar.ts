import { el, clear } from "./dom.js";
import { createTagFilter } from "./TagFilter.js";
import { createConversationBlock } from "./ConversationBlock.js";
import {
  allTags,
  sortByDateDesc,
  type Conversation,
  type Tag,
} from "../data/conversations.js";

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

const DAY_MS = 86_400_000;
const SECTIONS = ["Today", "Yesterday", "This Week", "This Month", "Older"] as const;
type Section = (typeof SECTIONS)[number];

// Bucket a conversation by how far its date is from the start of the current day.
function sectionFor(date: string, startOfToday: number): Section {
  const t = new Date(date).getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - DAY_MS) return "Yesterday";
  if (t >= startOfToday - 7 * DAY_MS) return "This Week";
  if (t >= startOfToday - 30 * DAY_MS) return "This Month";
  return "Older";
}

// Conversation navigator: a title row with filter/search actions over a
// scrollable, date-sorted list. The framework filter lives in a popover opened
// from the filter icon; it owns the active-filter state and re-renders the list
// in place on change.
export function createSidebar(conversations: Conversation[]): HTMLElement {
  const list = el("div", { class: "conversation-list" });

  const renderList = (active: Set<Tag>) => {
    const filtered =
      active.size === 0
        ? conversations
        : conversations.filter((c) => c.tags.some((t) => active.has(t)));
    const sorted = sortByDateDesc(filtered);

    clear(list);
    if (sorted.length === 0) {
      list.append(
        el("div", { class: "conversation-empty", text: "No conversations match." }),
      );
      return;
    }

    // Group the (already date-desc) list into date sections, newest first.
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const groups = new Map<Section, Conversation[]>();
    for (const c of sorted) {
      const section = sectionFor(c.date, startOfToday);
      const bucket = groups.get(section) ?? [];
      bucket.push(c);
      groups.set(section, bucket);
    }

    for (const section of SECTIONS) {
      const items = groups.get(section);
      if (!items) continue;
      list.append(el("div", { class: "conversation-section-header", text: section }));
      for (const c of items) list.append(createConversationBlock(c));
    }
  };

  // Filter order: "live" first, then frameworks in first-seen order.
  const tags = allTags(conversations).sort((a, b) =>
    a === "live" ? -1 : b === "live" ? 1 : 0,
  );

  // Filter popover: the tag filter, revealed from the filter icon. Anchored to a
  // position:relative wrapper; click outside closes it (MenuBar-style).
  const filterBtn = iconButton(FILTER_SVG, "Filter");
  const popover = el("div", { class: "filter-popover" }, [
    el("div", { class: "filter-popover-title", text: "Framework" }),
    createTagFilter(tags, renderList),
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

  renderList(new Set());

  return el("aside", { class: "sidebar" }, [header, list]);
}
