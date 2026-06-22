// Conversation model for the sidebar navigator. Data is fetched from the server
// (see api.ts); this module only defines the UI-facing types and small helpers.

// Tag values are the agentic framework a session belongs to, plus "live" to
// mark an in-progress session. They match the chip classes in components.css
// (.lm-tag.{claude-code,cursor,codex,live}) so chips pick up accent colors.
export type Tag =
  | "claude-code"
  | "cursor"
  | "codex"
  | "live";

// Effort/reasoning level the session ran the framework at.
export type Effort = "low" | "medium" | "high";

export interface Conversation {
  id: string;
  title: string;
  projectPath: string; // absolute path to the project the session ran in
  date: string; // ISO 8601
  tags: Tag[];
  model: string; // model the framework ran, e.g. "Claude Opus 4.7"
  effort: Effort;
}

export function sortByDateDesc(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => b.date.localeCompare(a.date));
}
