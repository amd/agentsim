// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

import { invoke } from "@tauri-apps/api/core";
import { el } from "./dom.js";
import type { Conversation } from "../data/conversations.js";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

// Three-dot "more options" icon (filled dots so they read at small sizes).
const KEBAB_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2.4"></circle><circle cx="12" cy="12" r="2.4"></circle><circle cx="19" cy="12" r="2.4"></circle></svg>';

// Only one kebab menu open at a time across all blocks.
let activeKebabClose: (() => void) | null = null;

// Only one conversation block selected at a time across all blocks.
let selectedBlock: HTMLElement | null = null;

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

// Open the OS file explorer at the given path. In the desktop app this goes
// through the Tauri opener plugin; in browser dev there's no host, so just log.
async function showInFiles(path: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    console.log(`[conversation] Show in Files: ${path}`);
    return;
  }
  try {
    await invoke("plugin:opener|open_path", { path });
  } catch (err) {
    console.error("[conversation] Show in Files failed", err);
  }
}

// Directory containing `filePath` — used to open the folder that holds the
// session's .jsonl transcript rather than the file itself.
function parentDir(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx > 0 ? filePath.slice(0, idx) : filePath;
}

// Open a terminal that resumes this session via the Claude Code CLI. No host in
// browser dev, so just log the command that would run.
async function launchSession(conversation: Conversation): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    console.log(`[conversation] Launch Session: claude --resume ${conversation.id} --model ${conversation.model}`);
    return;
  }
  try {
    await invoke("launch_session", {
      sessionId: conversation.id,
      model: conversation.model,
      projectPath: conversation.projectPath,
    });
  } catch (err) {
    console.error("[conversation] Launch Session failed", err);
  }
}

function createKebab(conversation: Conversation): HTMLElement {
  const btn = el("button", {
    class: "conversation-kebab lm-icon-btn",
    "aria-label": "Options",
    title: "Options",
  });
  btn.innerHTML = KEBAB_SVG;

  // Launch resumes the session via the `claude` CLI, so it's only meaningful for
  // Claude Code sessions; other frameworks omit it entirely.
  const canLaunch = conversation.framework === "claudecode";
  const launchItem = canLaunch ? el("div", { class: "item", text: "Launch Session" }) : null;
  const projectItem = el("div", { class: "item", text: "Open Project Folder" });
  const dataItem = el("div", { class: "item", text: "Open Transcript Folder" });
  const menu = el("div", { class: "lm-menu kebab-menu" }, [
    ...(launchItem ? [launchItem] : []),
    projectItem,
    dataItem,
  ]);
  menu.style.display = "none";

  const close = () => {
    menu.style.display = "none";
    btn.classList.remove("active");
    if (activeKebabClose === close) activeKebabClose = null;
  };
  const open = () => {
    menu.style.display = "";
    btn.classList.add("active");
    activeKebabClose = close;
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = menu.style.display !== "none";
    activeKebabClose?.();
    if (!isOpen) open();
  });
  menu.addEventListener("click", (e) => e.stopPropagation());
  launchItem?.addEventListener("click", () => {
    close();
    void launchSession(conversation);
  });
  projectItem.addEventListener("click", () => {
    close();
    void showInFiles(conversation.projectPath);
  });
  dataItem.addEventListener("click", () => {
    close();
    void showInFiles(parentDir(conversation.dataPath));
  });
  document.addEventListener("click", close);

  return el("div", { class: "conversation-kebab-wrap" }, [btn, menu]);
}

// `showTime` renders the wall-clock time instead of the date — used for the
// Today/Yesterday sections where a month/day label is redundant.
export function createConversationBlock(
  conversation: Conversation,
  showTime = false,
): HTMLElement {
  const tooltip = `${conversation.modelDisplay} · ${conversation.effort} effort`;
  const frameworkChip = el("span", {
    class: "lm-tag",
    text: conversation.frameworkName,
    title: tooltip,
  });
  if (conversation.frameworkColor) frameworkChip.style.color = conversation.frameworkColor;

  // Model chip sits in front of the framework chip and shares its brand color.
  const modelChip = conversation.modelDisplay
    ? el("span", { class: "lm-tag", text: conversation.modelDisplay, title: tooltip })
    : null;
  if (modelChip && conversation.frameworkColor) modelChip.style.color = conversation.frameworkColor;

  const tags = el("div", { class: "conversation-tags" }, [
    ...(modelChip ? [modelChip] : []),
    frameworkChip,
  ]);

  const title = el("div", { class: "conversation-title-row" }, [
    ...(conversation.isLive
      ? [el("span", { class: "live-dot", title: "Live" })]
      : []),
    el("span", { class: "conversation-title", text: conversation.title }),
    createKebab(conversation),
  ]);

  const subtitle = el("div", { class: "conversation-subtitle" });
  applyCollapsedPath(subtitle, conversation.projectPath);

  const block = el("div", { class: "conversation-block", "data-id": conversation.id }, [
    title,
    subtitle,
    el("div", { class: "conversation-meta" }, [
      el("span", {
        class: "conversation-date",
        text: (showTime ? timeFmt : dateFmt).format(new Date(conversation.date)),
      }),
      tags,
    ]),
  ]);

  // Click selects the conversation and broadcasts it so the canvas loads its
  // trace. Clicks inside the kebab (menu/button) must not trigger selection.
  block.addEventListener("click", (e) => {
    if ((e.target as Element).closest(".conversation-kebab-wrap")) return;
    if (selectedBlock && selectedBlock !== block) selectedBlock.classList.remove("selected");
    block.classList.add("selected");
    selectedBlock = block;
    window.dispatchEvent(
      new CustomEvent<Conversation>("conversation:select", { detail: conversation }),
    );
  });

  return block;
}
