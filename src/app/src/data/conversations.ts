// Mock conversation data for the sidebar navigator. Replace with a real API
// call once the backend exposes conversations.

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

// Build an ISO timestamp `days` before now (relative so the mocks always land in
// the same date sections regardless of when the app is opened).
function daysAgo(days: number, hour = 12, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export const conversations: Conversation[] = [
  {
    id: "c1",
    title: "Refactor inference loop",
    projectPath: "C:\\Users\\mdokukin\\dev\\codebase\\inference-engine",
    date: daysAgo(0, 14, 22),
    tags: ["claude-code", "live"],
    model: "Claude Opus 4.7",
    effort: "high",
  },
  {
    id: "c2",
    title: "Vision model comparison",
    projectPath: "C:\\Users\\mdokukin\\projects\\research\\vision-bench",
    date: daysAgo(1, 9, 5),
    tags: ["cursor"],
    model: "Claude Sonnet 4.6",
    effort: "medium",
  },
  {
    id: "c3",
    title: "RAG embeddings pipeline",
    projectPath: "C:\\dev\\codebase\\rag-pipeline",
    date: daysAgo(3, 18, 40),
    tags: ["codex"],
    model: "GPT-5",
    effort: "medium",
  },
  {
    id: "c4",
    title: "Tool-calling agent draft",
    projectPath: "C:\\Users\\mdokukin\\work\\agents\\tool-agent",
    date: daysAgo(5, 11, 15),
    tags: ["claude-code"],
    model: "Claude Sonnet 4.6",
    effort: "low",
  },
  {
    id: "c5",
    title: "Chain-of-thought prompts",
    projectPath: "D:\\experiments\\prompting\\cot-math",
    date: daysAgo(12, 16, 50),
    tags: ["cursor"],
    model: "GPT-5",
    effort: "high",
  },
  {
    id: "c6",
    title: "Reranker eval harness",
    projectPath: "C:\\dev\\eval\\reranker-harness",
    date: daysAgo(20, 8, 30),
    tags: ["codex"],
    model: "o3",
    effort: "medium",
  },
  {
    id: "c7",
    title: "Quantization experiments",
    projectPath: "C:\\Users\\mdokukin\\research\\quantization-lab",
    date: daysAgo(45, 13, 0),
    tags: ["claude-code"],
    model: "Claude Opus 4.7",
    effort: "medium",
  },
];

export function sortByDateDesc(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => b.date.localeCompare(a.date));
}

// Distinct tags across all conversations, in first-seen order — used to build
// the filter row.
export function allTags(items: Conversation[]): Tag[] {
  const seen = new Set<Tag>();
  for (const c of items) for (const t of c.tags) seen.add(t);
  return [...seen];
}
