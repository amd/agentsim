// Tiny DOM helper — our stand-in for a framework. Components are plain functions
// that build and return HTMLElements; `el` keeps that construction terse.

type Child = Node | string | null | undefined | false;

interface ElAttrs {
  class?: string;
  text?: string;
  // Any other attribute (id, title, type, data-*, aria-*, ...).
  [key: string]: string | undefined;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

// Remove all children from a node (used when re-rendering a list in place).
export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
