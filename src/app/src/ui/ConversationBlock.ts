import { el } from "./dom.js";
import type { Conversation } from "../data/conversations.js";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

export function createConversationBlock(conversation: Conversation): HTMLElement {
  const isLive = conversation.tags.includes("live");
  const frameworkTags = conversation.tags.filter((t) => t !== "live");

  const tags = el(
    "div",
    { class: "conversation-tags" },
    frameworkTags.map((t) => el("span", { class: `lm-tag ${t}`, text: t })),
  );

  const title = el("div", { class: "conversation-title-row" }, [
    el("span", { class: "conversation-title", text: conversation.title }),
    ...(isLive ? [el("span", { class: "lm-tag live", text: "live" })] : []),
  ]);

  return el("div", { class: "conversation-block", "data-id": conversation.id }, [
    title,
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
