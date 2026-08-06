// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

// Persistent, dismissable notification surface. Replaces the opaque "Cannot
// reach server." string with specifics, split into two classes:
//   * transport -- a request never got a response (server down / timed out),
//     keyed by endpoint so repeats coalesce; cleared automatically the moment
//     any request succeeds (proof the server is reachable again).
//   * data -- the server answered but the content failed: a client-observed
//     non-2xx (its `detail`), or a server-collected `/diagnostics` entry
//     (unreadable source / file parsed with records skipped).
// A singleton container is mounted once by AppShell; every call site pushes
// through the module-level helpers.

import { el, clear } from "./dom.js";
import { ApiError, clearDiagnostics, fetchDiagnostics, type Diagnostic } from "../data/api.js";

let container: HTMLElement | null = null;

// endpoint label -> human message. Coalesced so a poll that keeps failing
// updates one row instead of stacking.
const transport = new Map<string, string>();
// endpoint label -> server `detail` for a non-transport failure the client saw
// directly (e.g. a 500 the /diagnostics collector never recorded).
const dataErrors = new Map<string, string>();
// The server's own view of data-source health, refreshed after each load.
let serverDiags: Diagnostic[] = [];

// Build (once) and return the surface AppShell mounts. Idempotent: a second call
// returns the existing container so state survives re-mounts.
export function createNotifications(): HTMLElement {
  if (!container) {
    container = el("div", { class: "notifications", "aria-live": "polite" });
    render();
  }
  return container;
}

function icon(level: "warning" | "error"): string {
  return level === "error"
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
}

function item(
  level: "warning" | "error",
  title: string,
  detail: string,
  onDismiss: () => void,
): HTMLElement {
  const dismiss = el("button", {
    class: "notification-close", "aria-label": "Dismiss", text: "✕",
  });
  dismiss.addEventListener("click", onDismiss);

  const iconEl = el("span", { class: "notification-icon" });
  iconEl.innerHTML = icon(level);

  return el("div", { class: `notification notification-${level}` }, [
    iconEl,
    el("div", { class: "notification-text" }, [
      el("div", { class: "notification-title", text: title }),
      detail ? el("div", { class: "notification-detail", text: detail }) : null,
    ]),
    dismiss,
  ]);
}

// Label a server diagnostic: framework + file basename so the user can find it.
function diagTitle(d: Diagnostic): string {
  const file = d.path ? d.path.split(/[/\\]/).pop() || d.path : d.key;
  const fw = d.framework ? `${d.framework}: ` : "";
  return `${fw}${file}`;
}

function render(): void {
  if (!container) return;
  clear(container);

  for (const [endpoint, detail] of transport) {
    container.append(
      item("error", `Cannot reach server — ${endpoint}`, detail, () => {
        transport.delete(endpoint);
        render();
      }),
    );
  }

  for (const [endpoint, detail] of dataErrors) {
    container.append(
      item("error", `Request failed — ${endpoint}`, detail, () => {
        dataErrors.delete(endpoint);
        render();
      }),
    );
  }

  for (const d of serverDiags) {
    // A single dismiss clears the whole server-collected set (the only API the
    // server exposes); still-broken files re-record on the next load.
    container.append(
      item(d.level, diagTitle(d), d.message, () => {
        serverDiags = [];
        render();
        void clearDiagnostics().catch(() => {});
      }),
    );
  }
}

// Record a failed request. Transport failures (no response) and data failures
// (server answered non-2xx) route to their respective classes; both are keyed by
// endpoint so a repeating failure updates one row.
export function notifyFailure(error: unknown, endpoint: string): void {
  if (error instanceof ApiError) {
    if (error.isTransport) transport.set(endpoint, error.detail);
    else dataErrors.set(endpoint, error.detail);
  } else {
    dataErrors.set(endpoint, error instanceof Error ? error.message : String(error));
  }
  render();
}

// Mark a request as succeeded: the server is reachable, so drop every transport
// notification and any prior data error for this endpoint, then refresh the
// server-side diagnostics so parse warnings for a session that loaded *with*
// dropped records still surface.
export function notifySuccess(endpoint?: string): void {
  let changed = false;
  if (transport.size) {
    transport.clear();
    changed = true;
  }
  if (endpoint && dataErrors.delete(endpoint)) changed = true;
  if (changed) render();
  void syncDiagnostics();
}

// Pull the server's current data-source health into the surface.
export async function syncDiagnostics(): Promise<void> {
  let latest: Diagnostic[];
  try {
    latest = await fetchDiagnostics();
  } catch {
    return; // don't let the health poll itself raise a notification storm
  }
  serverDiags = latest;
  render();
}
