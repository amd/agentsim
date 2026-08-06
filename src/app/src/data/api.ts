// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

// HTTP client for the AgentSim server. The backend owns all data loading,
// management, and filtering; this module just builds requests from filter state
// and maps the wire types into the UI's Conversation model.

import type { Conversation } from "./conversations.js";
import type { Filters } from "../ui/FilterPanel.js";
import { DAY_MS, startOfToday, type Section } from "./sections.js";
import type { Span } from "../timeline/index.js";

const BASE = "http://localhost:4317";

// A single error shape for every request so the UI can tell a *transport*
// failure (server unreachable / timed out — no response at all) apart from a
// *data* failure (server answered with a 4xx/5xx). Carries the endpoint, the
// HTTP status (null for transport failures) and the parsed server `detail`, so a
// notification can say exactly what failed instead of a bare "Cannot reach
// server."
export class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly endpoint: string,
    readonly status: number | null,
    readonly detail: string,
  ) {
    super(detail || `${method} ${endpoint} failed`);
    this.name = "ApiError";
  }

  // No HTTP response ever arrived (connection refused, timeout, DNS, etc.).
  get isTransport(): boolean {
    return this.status === null;
  }
}

// Fail a stalled request instead of hanging forever, so a wedged server is a
// definite, reportable outcome (a transport ApiError) the notification surface
// can show rather than a spinner that never resolves.
const REQUEST_TIMEOUT_MS = 15000;

// Concurrent identical GETs share one in-flight promise, keyed by path. A single
// change fans out into overlapping duplicate scans (sidebar + modal both hit
// /sources, etc.); collapsing them to one request spares the single Python child
// a burst of redundant full re-parses.
const inFlight = new Map<string, Promise<unknown>>();

// GET a JSON endpoint, normalizing both failure modes into ApiError. A rejected
// or timed-out fetch (server down / unreachable) becomes a transport error
// (status null); a non-2xx response becomes a data error carrying the server's
// `detail`.
function apiGet<T>(path: string): Promise<T> {
  const existing = inFlight.get(path);
  if (existing) return existing as Promise<T>;

  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    } catch (error) {
      const detail = controller.signal.aborted
        ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : error instanceof Error ? error.message : String(error);
      throw new ApiError("GET", path, null, detail);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError("GET", path, res.status, body?.detail || `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  })();

  inFlight.set(path, request);
  return request.finally(() => inFlight.delete(path)) as Promise<T>;
}

// Poll the server until it answers, or until `timeoutMs` elapses. The bundled
// Python cold-starts slowly on first launch (Defender scan + .pyc compilation),
// so the renderer must wait for the backend instead of firing requests that
// fail with connection-refused. Resolves true once reachable, false on timeout.
export async function waitForServer(
  { timeoutMs = 60000, intervalMs = 400 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      // Connection refused — server not listening yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

// Client-facing app config mirrored from the server (config.json).
export interface AppConfig {
  is_first_startup: boolean;
}

// Read the app config. `is_first_startup` is true until the client marks startup
// complete; it drives the one-time auto-open of Manage Data Sources.
export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch(`${BASE}/config`);
  if (!res.ok) throw new Error(`GET /config failed: ${res.status}`);
  return (await res.json()) as AppConfig;
}

// Clear the first-startup flag on the server after handling first-run UI.
export async function markStartupComplete(): Promise<void> {
  const res = await fetch(`${BASE}/config/startup-complete`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /config/startup-complete failed: ${res.status}`);
}

// Wire shape of SessionMetadata (server-side field names).
interface WireSession {
  session_id: string;
  title: string;
  data_path: string;
  is_live: boolean;
  project_path: string;
  project_slug: string;
  model: string;
  model_display: string;
  effort_level: string;
  timestamp_created: string;
  timestamp_modified: string;
  source_id: string;
  framework: string;
  is_favorite: boolean;
  nickname: string;
}

// A data source the server knows about, at any life stage: the catalog of
// available framework types, an auto-detected candidate, or an active source.
// One shape serves every view -- fields that don't apply stay empty: `path` is
// "" for the plain catalog; `session_count` is 0 where no count is meaningful;
// `id` is the `/sources/{id}/...` routing key, set only for active sources.
export interface DataSource {
  alias: string; // framework format id (brand tag/color + filter facet)
  name: string;
  primary_color: string;
  path: string;
  session_count: number;
  id: string;
}

export interface ProjectFacet {
  path: string;
  name: string;
  count: number;
}

export interface ModelFacet {
  name: string;
  count: number;
}

export interface Facets {
  frameworks: DataSource[];
  projects: ProjectFacet[];
  models: ModelFacet[];
}

// Per-framework display metadata (name + brand color), keyed by alias. Sourced
// from the backend so the frontend hardcodes no framework colors. Cached for the
// session list's lifetime and invalidated when the active set changes.
interface FrameworkMeta {
  name: string;
  color: string;
}

let frameworkMeta: Map<string, FrameworkMeta> | null = null;

async function frameworkMetaMap(): Promise<Map<string, FrameworkMeta>> {
  if (frameworkMeta) return frameworkMeta;
  const frameworks = await fetchAvailableFrameworks();
  frameworkMeta = new Map(
    frameworks.map((f) => [f.alias, { name: f.name, color: f.primary_color }]),
  );
  return frameworkMeta;
}

// Adding/removing a data source changes the active set; drop the cache so the
// next fetch picks up the new framework metadata.
if (typeof window !== "undefined") {
  window.addEventListener("frameworks:changed", () => {
    frameworkMeta = null;
  });
}

function toConversation(s: WireSession, meta: Map<string, FrameworkMeta>): Conversation {
  const fw = meta.get(s.framework);
  return {
    id: s.session_id,
    title: s.title,
    projectPath: s.project_path,
    dataPath: s.data_path,
    date: s.timestamp_modified || s.timestamp_created,
    sourceId: s.source_id,
    framework: s.framework,
    frameworkName: fw?.name ?? s.framework,
    frameworkColor: fw?.color ?? "",
    isLive: s.is_live,
    model: s.model,
    modelDisplay: s.model_display || s.model,
    effort: (s.effort_level || "medium") as Conversation["effort"],
    isFavorite: s.is_favorite,
    nickname: s.nickname,
    comments: "", // loaded on demand via fetchSessionConfig (not in the list payload)
  };
}

// Translate the selected date Section into a half-open [from, to) instant range
// matching sectionFor()'s bucketing, so the server does the date filtering.
function dateRange(date: Section | "all"): { from?: string; to?: string } {
  if (date === "all") return {};
  const start = startOfToday();
  const iso = (ms: number) => new Date(ms).toISOString();
  switch (date) {
    case "Today":
      return { from: iso(start) };
    case "Yesterday":
      return { from: iso(start - DAY_MS), to: iso(start) };
    case "This Week":
      return { from: iso(start - 7 * DAY_MS), to: iso(start - DAY_MS) };
    case "This Month":
      return { from: iso(start - 30 * DAY_MS), to: iso(start - 7 * DAY_MS) };
    case "Older":
      return { to: iso(start - 30 * DAY_MS) };
  }
}

function queryFor(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.frameworks.size > 0) params.set("framework", [...filters.frameworks].join(","));
  if (filters.live) params.set("live", "true");
  if (filters.favorites) params.set("favorite", "true");
  if (filters.projects.size > 0) params.set("project", [...filters.projects].join(","));
  if (filters.models.size > 0) params.set("model", [...filters.models].join(","));
  const { from, to } = dateRange(filters.date);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchSessions(filters: Filters): Promise<Conversation[]> {
  const [rows, meta] = await Promise.all([
    apiGet<WireSession[]>(`/sessions${queryFor(filters)}`),
    frameworkMetaMap(),
  ]);
  return rows.map((row) => toConversation(row, meta));
}

export async function fetchFacets(): Promise<Facets> {
  return apiGet<Facets>("/sessions/facets");
}

// Wire shape of SessionTrace. `spans` matches the widget's Span contract field
// for field, so they're fed to the timeline natively (no adapter).
interface WireTrace {
  session_id: string;
  spans: Span[];
}

// The full ordered span trace for one session, used to render the timeline.
export async function fetchTrace(sourceId: string, sessionId: string): Promise<Span[]> {
  const path = `/sources/${encodeURIComponent(sourceId)}/sessions/${encodeURIComponent(sessionId)}`;
  const trace = await apiGet<WireTrace>(path);
  return trace.spans;
}

// --- Data source management ------------------------------------------------
// The backend owns the active set; these mirror its CRUD endpoints so the
// Manage Data Sources UI stays a thin view over the server. A source is one
// (framework, path) pair where path is a folder OR a single trace file.

export async function fetchSources(): Promise<DataSource[]> {
  return apiGet<DataSource[]>("/sources");
}

export async function fetchAvailableFrameworks(): Promise<DataSource[]> {
  return apiGet<DataSource[]>("/frameworks/available");
}

export async function fetchDetectedFrameworks(): Promise<DataSource[]> {
  return apiGet<DataSource[]>("/frameworks/detected");
}

export interface SourceValidation {
  valid: boolean;
  session_count: number;
  error: string;
}

// Check whether `path` (a folder or a file) holds readable sessions for
// `framework` before adding it.
export async function validateSource(framework: string, path?: string): Promise<SourceValidation> {
  const res = await fetch(`${BASE}/sources/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ framework, path: path || null }),
  });
  if (!res.ok) throw new Error(`POST /sources/validate failed: ${res.status}`);
  return (await res.json()) as SourceValidation;
}

export async function addSource(
  framework: string,
  path?: string,
  watch = false,
): Promise<DataSource> {
  const res = await fetch(`${BASE}/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ framework, path: path || null, watch }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const err = new Error(detail?.detail || `POST /sources failed: ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as DataSource;
}

export async function removeSource(id: string): Promise<void> {
  const res = await fetch(`${BASE}/sources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `DELETE /sources/${id} failed: ${res.status}`);
  }
}

// --- Per-session user config (favorite / nickname / comments) ---------------
// User-owned metadata the frameworks don't provide, keyed by (framework,
// session_id) on the server so it's independent of the source that surfaced the
// session. The list payload carries is_favorite + nickname; comments are fetched
// on demand here (they can be large).

export interface SessionUserConfig {
  is_favorite: boolean;
  nickname: string;
  comments: string;
}

export type SessionUserConfigPatch = Partial<SessionUserConfig>;

function sessionConfigUrl(framework: string, sessionId: string): string {
  return `${BASE}/session-configs/${encodeURIComponent(framework)}/${encodeURIComponent(sessionId)}`;
}

export async function fetchSessionConfig(
  framework: string,
  sessionId: string,
): Promise<SessionUserConfig> {
  const res = await fetch(sessionConfigUrl(framework, sessionId));
  if (!res.ok) throw new Error(`GET session config failed: ${res.status}`);
  return (await res.json()) as SessionUserConfig;
}

// Partial update: only the provided fields change (a star toggle won't clobber a
// nickname/comments). Returns the merged config.
export async function updateSessionConfig(
  framework: string,
  sessionId: string,
  patch: SessionUserConfigPatch,
): Promise<SessionUserConfig> {
  const res = await fetch(sessionConfigUrl(framework, sessionId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH session config failed: ${res.status}`);
  return (await res.json()) as SessionUserConfig;
}

// --- Data-source diagnostics -----------------------------------------------
// Failures collected server-side off the request path: a whole source that
// can't be read (`error`) or a file parsed with some records dropped
// (`warning`). The client polls this after a load so a session that rendered
// *with* skipped records still tells the user what was lost.

export interface Diagnostic {
  level: "warning" | "error";
  key: string;
  message: string;
  framework: string;
  source_id: string;
  path: string;
  count: number;
  timestamp: number;
}

export async function fetchDiagnostics(): Promise<Diagnostic[]> {
  return apiGet<Diagnostic[]>("/diagnostics");
}

export async function clearDiagnostics(): Promise<void> {
  const res = await fetch(`${BASE}/diagnostics`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /diagnostics failed: ${res.status}`);
}
