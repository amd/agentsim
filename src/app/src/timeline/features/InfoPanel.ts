// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

import { prettyType, spanDurationMs } from "../core/spans";
import { formatClockMs } from "../core/time";
import type { SelectEventPayload } from "../types";

export interface InfoPanelHandle {
  el: HTMLElement;
  show: (payload: SelectEventPayload) => void;
  reset: () => void;
  destroy: () => void;
}

/** Details panel for the currently selected span. */
export function createInfoPanel(): InfoPanelHandle {
  const el = document.createElement("div");
  el.className = "tlw-info";

  const panel = document.createElement("div");
  panel.className = "tlw-info-panel";

  const title = document.createElement("div");
  title.className = "tlw-info-title";
  const subtitle = document.createElement("div");
  subtitle.className = "tlw-info-subtitle";
  const body = document.createElement("div");
  body.className = "tlw-info-body";

  panel.append(title, subtitle, body);
  el.appendChild(panel);

  const reset = () => {
    title.textContent = "No span selected";
    subtitle.innerHTML = "&nbsp;";
    body.textContent = "Click a span to see its details.";
  };

  const show = (payload: SelectEventPayload) => {
    const { type, span, merged, startMs, endMs } = payload;
    const durationMs = span ? spanDurationMs(span) : Math.max(0, endMs - startMs);
    const timing = `${formatClockMs(startMs)} → ${formatClockMs(endMs)} · ${durationMs} ms`;

    if (merged || !span) {
      title.textContent = `${prettyType(type)} · merged`;
      subtitle.textContent = `${timing} (union of overlapping spans)`;
      body.textContent = "Merged coverage of overlapping spans in this section.";
      return;
    }

    title.textContent = span.title;
    subtitle.textContent = `${prettyType(type)} · ${timing}`;
    body.textContent = span.content?.trim() ? span.content : "(no content)";
  };

  reset();

  return {
    el,
    show,
    reset,
    destroy: () => el.remove(),
  };
}
