// Conversation model for the sidebar navigator. Data is fetched from the server
// (see api.ts); this module only defines the UI-facing types.

// Effort/reasoning level the session ran the framework at.
export type Effort = "low" | "medium" | "high";

export interface Conversation {
  id: string;
  title: string;
  projectPath: string; // absolute path to the project the session ran in
  date: string; // ISO 8601
  framework: string; // backend alias, e.g. "claudecode"
  frameworkName: string; // display name, e.g. "Claude Code"
  frameworkColor: string; // CSS hex from the backend, e.g. "#D97757"
  isLive: boolean; // session still being appended to
  model: string; // model the framework ran, e.g. "Claude Opus 4.7"
  effort: Effort;
}
