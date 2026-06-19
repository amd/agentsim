import { el, clear } from "./dom.js";
import { createTagFilter } from "./TagFilter.js";
import { createConversationBlock } from "./ConversationBlock.js";
import {
  allTags,
  sortByDateDesc,
  type Conversation,
  type Tag,
} from "../data/conversations.js";

// Conversation navigator: tag-filter row over a scrollable, date-sorted list.
// Owns the active-filter state and re-renders the list in place on change.
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
    for (const c of sorted) list.append(createConversationBlock(c));
  };

  // Filter order: "live" first, then frameworks in first-seen order.
  const tags = allTags(conversations).sort((a, b) =>
    a === "live" ? -1 : b === "live" ? 1 : 0,
  );

  const header = el("div", { class: "sidebar-header" }, [
    el("h3", { class: "sidebar-title", text: "Conversations" }),
    createTagFilter(tags, renderList),
  ]);

  renderList(new Set());

  return el("aside", { class: "sidebar" }, [header, list]);
}
