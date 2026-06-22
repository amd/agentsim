// HTTP client for the agent-sim server. The backend owns all data loading,
// management, and filtering; this module just builds requests from filter state
// and maps the wire types into the UI's Conversation model.

import type { Conversation, Tag } from "./conversations.js";
import type { Filters } from "../ui/FilterPanel.js";
import { DAY_MS, startOfToday, type Section } from "./sections.js";

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
  effort_level: string;
  timestamp_created: string;
  timestamp_modified: string;
  framework: string;
}

export interface FrameworkFacet {
  alias: string;
  name: string;
  count: number;
}

export interface ProjectFacet {
  path: string;
  name: string;
  count: number;
}

export interface Facets {
  frameworks: FrameworkFacet[];
  projects: ProjectFacet[];
}

// An active framework backend (a data source the server is serving).
export interface FrameworkInfo {
  alias: string;
  name: string;
  data_basepath: string;
  session_count: number;
}

// A framework type the server knows how to build, whether or not it's active.
export interface AvailableFramework {
  alias: string;
  name: string;
}

// Backend framework alias -> the UI Tag whose chip carries the accent color.
const ALIAS_TO_TAG: Record<string, Tag> = {
  claudecode: "claude-code",
  cursor: "cursor",
  codex: "codex",
};

function aliasToTag(alias: string): Tag {
  return ALIAS_TO_TAG[alias] ?? "claude-code";
}

function toConversation(s: WireSession): Conversation {
  const tags: Tag[] = [aliasToTag(s.framework)];
  if (s.is_live) tags.push("live");
  return {
    id: s.session_id,
    title: s.title,
    projectPath: s.project_path,
    date: s.timestamp_modified || s.timestamp_created,
    tags,
    model: s.model,
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
  const { from, to } = dateRange(filters.date);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchSessions(filters: Filters): Promise<Conversation[]> {
  const res = await fetch(`${BASE}/sessions${queryFor(filters)}`);
  if (!res.ok) throw new Error(`GET /sessions failed: ${res.status}`);
  const rows = (await res.json()) as WireSession[];
  return rows.map(toConversation);
}

export async function fetchFacets(): Promise<Facets> {
  const res = await fetch(`${BASE}/sessions/facets`);
  if (!res.ok) throw new Error(`GET /sessions/facets failed: ${res.status}`);
  return (await res.json()) as Facets;
}

// --- Framework (data source) management ------------------------------------
// The backend owns the active set; these mirror its CRUD endpoints so the
// Manage Data Sources UI stays a thin view over the server.

export async function fetchFrameworks(): Promise<FrameworkInfo[]> {
  const res = await fetch(`${BASE}/frameworks`);
  if (!res.ok) throw new Error(`GET /frameworks failed: ${res.status}`);
  return (await res.json()) as FrameworkInfo[];
}

export async function fetchAvailableFrameworks(): Promise<AvailableFramework[]> {
  const res = await fetch(`${BASE}/frameworks/available`);
  if (!res.ok) throw new Error(`GET /frameworks/available failed: ${res.status}`);
  return (await res.json()) as AvailableFramework[];
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
