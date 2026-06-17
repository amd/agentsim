import { el } from "./dom.js";
import type { Tag } from "../data/conversations.js";

// Row of toggleable tag pills plus an "All" reset. Active set starts empty,
// which means "no filter" (show everything). onChange fires the current set.
export function createTagFilter(
  tags: Tag[],
  onChange: (active: Set<Tag>) => void,
): HTMLElement {
  const active = new Set<Tag>();

  const allPill = el("span", { class: "tag-pill active", text: "All" });

  const tagPills = tags.map((tag) =>
    el("span", { class: "tag-pill", text: tag, "data-tag": tag }),
  );

  const syncActiveClass = () => {
    allPill.classList.toggle("active", active.size === 0);
    for (const pill of tagPills) {
      const tag = pill.dataset.tag as Tag;
      pill.classList.toggle("active", active.has(tag));
    }
  };

  allPill.addEventListener("click", () => {
    active.clear();
    syncActiveClass();
    onChange(active);
  });

  for (const pill of tagPills) {
    pill.addEventListener("click", () => {
      const tag = pill.dataset.tag as Tag;
      if (active.has(tag)) active.delete(tag);
      else active.add(tag);
      syncActiveClass();
      onChange(active);
    });
  }

  return el("div", { class: "tag-filter" }, [allPill, ...tagPills]);
}
