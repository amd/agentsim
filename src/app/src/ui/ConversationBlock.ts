import { el } from "./dom.js";
import type { Conversation } from "../data/conversations.js";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

// Offscreen canvas for measuring text width in the subtitle's actual font.
const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d")!;

// Collapse an absolute path to "drive/.../tail": always show the drive, then as
// many trailing path segments as fit within maxWidth. If the whole path fits,
// it's shown in full (no ellipsis). measure() returns the pixel width of a string.
function collapsePath(
  fullPath: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  const parts = fullPath.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return fullPath;

  const drive = parts[0].replace(/:$/, "");
  const rest = parts.slice(1);

  const full = [drive, ...rest].join("/");
  if (rest.length === 0 || measure(full) <= maxWidth) return full;

  const prefix = `${drive}/.../`;

  // Grow the suffix by whole trailing segments while it still fits.
  let suffix = "";
  for (let i = rest.length - 1; i >= 0; i--) {
    const candidate = rest.slice(i).join("/");
    if (measure(prefix + candidate) <= maxWidth) suffix = candidate;
    else break;
  }
  if (suffix) return prefix + suffix;

  // Even the last segment alone doesn't fit: char-truncate it, keeping the end.
  let last = rest[rest.length - 1];
  while (last.length > 1 && measure(prefix + last) > maxWidth) last = last.slice(1);
  return prefix + last;
}

// Fill the node with the path collapsed to its laid-out width. Retries until the
// node has a measurable width (it may not be laid out on the first frame), with a
// cap so a hidden sidebar doesn't spin forever.
function applyCollapsedPath(node: HTMLElement, fullPath: string): void {
  node.title = fullPath;
  let attempts = 0;
  const render = () => {
    const width = node.clientWidth;
    if (width <= 0) {
      if (attempts++ < 20) requestAnimationFrame(render);
      return;
    }
    const cs = getComputedStyle(node);
    measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    node.textContent = collapsePath(fullPath, width, (s) => measureCtx.measureText(s).width);
  };
  requestAnimationFrame(render);
}

export function createConversationBlock(conversation: Conversation): HTMLElement {
  const isLive = conversation.tags.includes("live");
  const frameworkTags = conversation.tags.filter((t) => t !== "live");

  const tooltip = `${conversation.model} · ${conversation.effort} effort`;
  const tags = el(
    "div",
    { class: "conversation-tags" },
    frameworkTags.map((t) =>
      el("span", { class: `lm-tag ${t}`, text: t, title: tooltip }),
    ),
  );

  const title = el("div", { class: "conversation-title-row" }, [
    el("span", { class: "conversation-title", text: conversation.title }),
    ...(isLive ? [el("span", { class: "lm-tag live", text: "live" })] : []),
  ]);

  const subtitle = el("div", { class: "conversation-subtitle" });
  applyCollapsedPath(subtitle, conversation.projectPath);

  return el("div", { class: "conversation-block", "data-id": conversation.id }, [
    title,
    subtitle,
    el("div", { class: "conversation-meta" }, [
      el("span", {
        class: "conversation-date",
        text: dateFmt.format(new Date(conversation.date)),
      }),
      tags,
    ]),
  ]);
}
