// HTTP client for the agent-sim server. The backend owns all data loading,
// management, and filtering; this module just builds requests from filter state
// and maps the wire types into the UI's Conversation model.

import type { Conversation } from "./conversations.js";
import type { Filters } from "../ui/FilterPanel.js";
import { DAY_MS, startOfToday, type Section } from "./sections.js";
import type { Span } from "../timeline/index.js";

const BASE = "http://localhost:4317";

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
  framework: string;
}

// One shape for every framework (data source) view: the active set, the catalog
// of available types, auto-detected sources, and the filter facets. Fields that
// don't apply to a given view come back at their defaults ("" / 0).
export interface FrameworkInfo {
  alias: string;
  name: string;
  primary_color: string;
  data_basepath: string;
  session_count: number;
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
  frameworks: FrameworkInfo[];
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
  const frameworks = await fetchFrameworks();
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
    framework: s.framework,
    frameworkName: fw?.name ?? s.framework,
    frameworkColor: fw?.color ?? "",
    isLive: s.is_live,
    model: s.model,
    modelDisplay: s.model_display || s.model,
    effort: (s.effort_level || "medium") as Conversation["effort"],
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
  if (filters.projects.size > 0) params.set("project", [...filters.projects].join(","));
  if (filters.models.size > 0) params.set("model", [...filters.models].join(","));
  const { from, to } = dateRange(filters.date);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchSessions(filters: Filters): Promise<Conversation[]> {
  const [res, meta] = await Promise.all([
    fetch(`${BASE}/sessions${queryFor(filters)}`),
    frameworkMetaMap(),
  ]);
  if (!res.ok) throw new Error(`GET /sessions failed: ${res.status}`);
  const rows = (await res.json()) as WireSession[];
  return rows.map((row) => toConversation(row, meta));
}

export async function fetchFacets(): Promise<Facets> {
  const res = await fetch(`${BASE}/sessions/facets`);
  if (!res.ok) throw new Error(`GET /sessions/facets failed: ${res.status}`);
  return (await res.json()) as Facets;
}

// Wire shape of SessionTrace. `spans` matches the widget's Span contract field
// for field, so they're fed to the timeline natively (no adapter).
interface WireTrace {
  session_id: string;
  spans: Span[];
}

// The full ordered span trace for one session, used to render the timeline.
export async function fetchTrace(framework: string, sessionId: string): Promise<Span[]> {
  const url = `${BASE}/frameworks/${encodeURIComponent(framework)}/sessions/${encodeURIComponent(sessionId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  const trace = (await res.json()) as WireTrace;
  return trace.spans;
}

// --- Framework (data source) management ------------------------------------
// The backend owns the active set; these mirror its CRUD endpoints so the
// Manage Data Sources UI stays a thin view over the server.

export async function fetchFrameworks(): Promise<FrameworkInfo[]> {
  const res = await fetch(`${BASE}/frameworks`);
  if (!res.ok) throw new Error(`GET /frameworks failed: ${res.status}`);
  return (await res.json()) as FrameworkInfo[];
}

export async function fetchAvailableFrameworks(): Promise<FrameworkInfo[]> {
  const res = await fetch(`${BASE}/frameworks/available`);
  if (!res.ok) throw new Error(`GET /frameworks/available failed: ${res.status}`);
  return (await res.json()) as FrameworkInfo[];
}

export async function fetchDetectedFrameworks(): Promise<FrameworkInfo[]> {
  const res = await fetch(`${BASE}/frameworks/detected`);
  if (!res.ok) throw new Error(`GET /frameworks/detected failed: ${res.status}`);
  return (await res.json()) as FrameworkInfo[];
}

export interface FrameworkValidation {
  valid: boolean;
  session_count: number;
  error: string;
}

// Check whether `path` holds readable sessions for `alias` before adding it.
export async function validateFramework(alias: string, path?: string): Promise<FrameworkValidation> {
  const res = await fetch(`${BASE}/frameworks/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias, path: path || null }),
  });
  if (!res.ok) throw new Error(`POST /frameworks/validate failed: ${res.status}`);
  return (await res.json()) as FrameworkValidation;
}

export async function addFramework(alias: string, path?: string): Promise<FrameworkInfo> {
  const res = await fetch(`${BASE}/frameworks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias, path: path || null }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `POST /frameworks failed: ${res.status}`);
  }
  return (await res.json()) as FrameworkInfo;
}

export async function removeFramework(alias: string): Promise<void> {
  const res = await fetch(`${BASE}/frameworks/${encodeURIComponent(alias)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `DELETE /frameworks/${alias} failed: ${res.status}`);
  }
}
