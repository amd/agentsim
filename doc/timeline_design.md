# Timeline Implementation Design

## Overview

The timeline view renders a Claude session as a horizontal multi-track visualization using **vis-timeline**. Each block in the session (user message, assistant message, thinking, tool call) becomes a draggable item on the timeline. Blocks are grouped by type into collapsible lanes — similar to GarageBand's arrange view.

---

## Library

**vis-timeline v7.7.3** (already loaded via CDN in `index.html`).

---

## Data Model

Each timeline block coming from `/api/sessions/{id}/timeline` has:

```ts
{
  start_time: string,  // ISO timestamp
  end_time:   string,  // ISO timestamp
  type:       "user_message" | "assistant_message" | "thinking" | "tool_call" | "attachment",
  title:      string,
  content:    string | object
}
```

---

## Group Structure

Map each `type` to a vis-timeline group. Use **nested groups** to allow section collapse/expand.

```
▼ Agent (parent, collapsible)
    thinking
    assistant_message
▼ User (parent, collapsible)
    user_message
▼ Tools (parent, collapsible)
    tool_call
    attachment
```

### Group definitions

```js
const groups = new vis.DataSet([
  { id: "agent",            content: "Agent",    nestedGroups: ["thinking", "assistant_message"] },
  { id: "thinking",         content: "Thinking" },
  { id: "assistant_message",content: "Assistant" },
  { id: "user",             content: "User",     nestedGroups: ["user_message"] },
  { id: "user_message",     content: "Message" },
  { id: "tools",            content: "Tools",    nestedGroups: ["tool_call", "attachment"] },
  { id: "tool_call",        content: "Tool Call" },
  { id: "attachment",       content: "Attachment" },
]);
```

**Critical:** groups must be a `vis.DataSet`, not a plain array — otherwise collapse does not work (known vis-timeline bug).

---

## Item Mapping

Convert each block from the API to a vis-timeline item, setting `group` to the block's `type`:

```js
const items = new vis.DataSet(blocks.map((b, i) => ({
  id:        i,
  group:     b.type,
  content:   escapeHtml(b.title || b.type),
  start:     b.start_time,
  end:       b.end_time,
  className: "tl-" + b.type,
  title:     buildTooltip(b),   // shown on hover
})));
```

---

## Timeline Options

```js
const options = {
  stack:            true,
  horizontalScroll: true,
  zoomKey:          "ctrlKey",
  margin:           { item: 6 },
  tooltip:          { followMouse: true },
  minHeight:        300,
  maxHeight:        600,
  orientation:      { axis: "top" },
};
```

---

## Initialization

```js
const container = document.getElementById("timeline");
const timeline  = new vis.Timeline(container, items, groups, options);
timeline.fit();
```

---

## Collapse / Expand

Nested groups render with a toggle arrow automatically. To start a section collapsed, set `showNested: false` on the parent group:

```js
groups.update({ id: "tools", showNested: false });
```

To toggle all sections programmatically (e.g. a "Collapse All" button):

```js
function setAllNested(expanded) {
  ["agent", "user", "tools"].forEach(id =>
    groups.update({ id, showNested: expanded })
  );
}
```

---

## Block Selection → Detail Panel

Wire the `select` event to populate the detail panel below the timeline:

```js
timeline.on("select", ({ items }) => {
  if (items.length === 0) return;
  renderBlockDetail(blocks[items[0]]);
});
```

---

## Color Coding

Apply per-type colors via CSS using the `className` set on each item:

```css
.tl-thinking          { background: #e8d5ff; border-color: #a855f7; }
.tl-assistant_message { background: #d1fae5; border-color: #10b981; }
.tl-user_message      { background: #dbeafe; border-color: #3b82f6; }
.tl-tool_call         { background: #fef3c7; border-color: #f59e0b; }
.tl-attachment        { background: #f3f4f6; border-color: #6b7280; }
```

---

## Known Gotchas

| Issue | Fix |
|---|---|
| Collapse arrow appears but doesn't hide children | Groups must be `vis.DataSet`, not a plain array |
| Click on collapse arrow fires `select` with no group ID | Ignore events where `items` is empty |
| Items with identical `start` and `end` are invisible | Enforce a minimum duration (e.g. 1 second) when `start === end` |
| `fit()` called before DOM is ready | Call `fit()` after `setTimeout(0)` or inside a `requestAnimationFrame` |
