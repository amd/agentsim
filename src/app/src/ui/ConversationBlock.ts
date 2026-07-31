// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

import { invoke } from "@tauri-apps/api/core";
import { el } from "./dom.js";
import { fetchSessionConfig, updateSessionConfig } from "../data/api.js";
import type { SessionUserConfigPatch } from "../data/api.js";
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

// Filled star, shown on favorited rows next to the title.
const STAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';

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

// Flip the favorite flag on the server, mirror it locally, and let the sidebar
// re-render (so the star glyph and any active Favorites filter stay in sync).
async function toggleFavorite(conversation: Conversation): Promise<void> {
  const next = !conversation.isFavorite;
  try {
    await updateSessionConfig(conversation.framework, conversation.id, { is_favorite: next });
    conversation.isFavorite = next;
    window.dispatchEvent(new Event("sessions:changed"));
  } catch (err) {
    console.error("[conversation] toggle favorite failed", err);
  }
}

// Which per-session text field the editor writes. Both are string columns on
// SessionUserConfig and on Conversation, so the modal is field-agnostic.
type EditableField = "nickname" | "comments";

interface SessionEditOptions {
  field: EditableField;
  title: string;
  // false → single-line <input> (nickname); true → multi-line <textarea>
  // (comments). This is the only structural difference between the two editors.
  multiline: boolean;
  initialValue: string;
  placeholder: string;
  // Run after a successful save/clear (e.g. nickname re-renders the sidebar).
  onSaved?: () => void;
}

// Shared modal to set/clear one per-session text field. Reuses the overlay/modal
// styles from Manage Data Sources. Saving an empty value clears the field (the
// server merges "" back toward default, deleting the file if all-default).
function editSessionField(conversation: Conversation, opts: SessionEditOptions): void {
  const editor = (
    opts.multiline
      ? el("textarea", { class: "session-edit-textarea", placeholder: opts.placeholder })
      : el("input", { class: "session-edit-input", type: "text", placeholder: opts.placeholder })
  ) as HTMLInputElement | HTMLTextAreaElement;
  editor.value = opts.initialValue;

  const closeBtn = el("button", {
    class: "lm-icon-btn ds-close", "aria-label": "Close", text: "✕",
  });
  const cancel = el("button", { class: "lm-btn lm-btn-secondary", text: "Cancel" });
  const save = el("button", { class: "lm-btn lm-btn-primary", text: "Save" });
  // Only offer delete when a value is actually set.
  const del = opts.initialValue
    ? el("button", { class: "lm-btn lm-btn-danger", text: "Delete" })
    : null;

  const modal = el("div", { class: "ds-picker session-edit" }, [
    el("div", { class: "ds-header" }, [
      el("h3", { class: "ds-title", text: opts.title }),
      closeBtn,
    ]),
    el("div", { class: "ds-picker-body" }, [
      editor,
      el("div", { class: "session-edit-actions" }, [
        ...(del ? [del] : []),
        el("div", { class: "session-edit-actions-right" }, [cancel, save]),
      ]),
    ]),
  ]);
  const overlay = el("div", { class: "ds-overlay" }, [modal]);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    // Enter commits single-line inputs; a textarea keeps Enter for newlines.
    else if (e.key === "Enter" && !opts.multiline) void commit();
  };
  const commit = async (): Promise<void> => {
    const value = editor.value.trim();
    const patch: SessionUserConfigPatch =
      opts.field === "comments" ? { comments: value } : { nickname: value };
    try {
      await updateSessionConfig(conversation.framework, conversation.id, patch);
      conversation[opts.field] = value;
      opts.onSaved?.();
    } catch (err) {
      console.error(`[conversation] set ${opts.field} failed`, err);
    }
    close();
  };

  closeBtn.addEventListener("click", close);
  cancel.addEventListener("click", close);
  save.addEventListener("click", () => void commit());
  del?.addEventListener("click", () => {
    editor.value = "";
    void commit();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  document.body.append(overlay);
  editor.focus();
  if (!opts.multiline) (editor as HTMLInputElement).select();
}

// Nickname is displayed in the sidebar, so a change must re-render the list.
function editNickname(conversation: Conversation): void {
  editSessionField(conversation, {
    field: "nickname",
    title: "Set nickname",
    multiline: false,
    initialValue: conversation.nickname,
    placeholder: conversation.title,
    onSaved: () => window.dispatchEvent(new Event("sessions:changed")),
  });
}

// Comments aren't in the list payload, so fetch the current value before opening
// the editor. They're not shown in the sidebar, so no sessions:changed on save.
async function editComments(conversation: Conversation): Promise<void> {
  try {
    const cfg = await fetchSessionConfig(conversation.framework, conversation.id);
    conversation.comments = cfg.comments;
  } catch (err) {
    console.error("[conversation] fetch comments failed", err);
  }
  editSessionField(conversation, {
    field: "comments",
    title: "Edit comments",
    multiline: true,
    initialValue: conversation.comments,
    placeholder: "Add comments…",
  });
}

function createKebab(conversation: Conversation): HTMLElement {
  const btn = el("button", {
    class: "conversation-kebab lm-icon-btn",
    "aria-label": "Options",
    title: "Options",
  });
  btn.innerHTML = KEBAB_SVG;

  const starItem = el("div", {
    class: "item",
    text: conversation.isFavorite ? "Unstar" : "Star",
  });
  const nicknameItem = el("div", { class: "item", text: "Set Nickname…" });
  const commentsItem = el("div", { class: "item", text: "Edit Comments…" });
  // Launch resumes the session via the `claude` CLI, so it's only meaningful for
  // Claude Code sessions; other frameworks omit it entirely.
  const canLaunch = conversation.framework === "claudecode";
  const launchItem = canLaunch ? el("div", { class: "item", text: "Launch Session" }) : null;
  const projectItem = el("div", { class: "item", text: "Open Project Folder" });
  const dataItem = el("div", { class: "item", text: "Open Transcript Folder" });
  const menu = el("div", { class: "lm-menu kebab-menu" }, [
    starItem,
    nicknameItem,
    commentsItem,
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
  starItem.addEventListener("click", () => {
    close();
    void toggleFavorite(conversation);
  });
  nicknameItem.addEventListener("click", () => {
    close();
    editNickname(conversation);
  });
  commentsItem.addEventListener("click", () => {
    close();
    void editComments(conversation);
  });
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

  const star = el("span", { class: "conversation-star", title: "Favorite" });
  star.innerHTML = STAR_SVG;

  // A nickname (if set) replaces the title in the list; the original title stays
  // reachable as the hover tooltip.
  const titleText = conversation.nickname || conversation.title;
  const title = el("div", { class: "conversation-title-row" }, [
    ...(conversation.isLive
      ? [el("span", { class: "live-dot", title: "Live" })]
      : []),
    ...(conversation.isFavorite ? [star] : []),
    el("span", { class: "conversation-title", text: titleText, title: conversation.title }),
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
