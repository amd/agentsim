import { el } from "./dom.js";
import type { Conversation } from "../data/conversations.js";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

export function createConversationBlock(conversation: Conversation): HTMLElement {
  const tags = el(
    "div",
    { class: "conversation-tags" },
    conversation.tags.map((t) => el("span", { class: `lm-tag ${t}`, text: t })),
  );

  return el("div", { class: "conversation-block", "data-id": conversation.id }, [
    el("div", { class: "conversation-title", text: conversation.title }),
    el("div", { class: "conversation-subtitle", text: conversation.subtitle }),
    el("div", { class: "conversation-meta" }, [
      el("span", {
        class: "conversation-date",
        text: dateFmt.format(new Date(conversation.date)),
      }),
      tags,
    ]),
  ]);
}
