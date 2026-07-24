// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

// Conversation model for the sidebar navigator. Data is fetched from the server
// (see api.ts); this module only defines the UI-facing types.

// Effort/reasoning level the session ran the framework at.
export type Effort = "low" | "medium" | "high";

export interface Conversation {
  id: string;
  title: string;
  projectPath: string; // absolute path to the project the session ran in
  dataPath: string; // absolute path to the session's transcript (.jsonl) file
  date: string; // ISO 8601
  framework: string; // backend alias, e.g. "claudecode"
  frameworkName: string; // display name, e.g. "Claude Code"
  frameworkColor: string; // CSS hex from the backend, e.g. "#D97757"
  isLive: boolean; // session still being appended to
  model: string; // canonical model id, e.g. "claude-opus-4-8" (used to launch the CLI)
  modelDisplay: string; // human-facing label, e.g. "opus-4-8" (shown in chips)
  effort: Effort;
}
