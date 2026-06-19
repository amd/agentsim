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

export interface Conversation {
  id: string;
  title: string;
  subtitle: string;
  date: string; // ISO 8601
  tags: Tag[];
}

export const conversations: Conversation[] = [
  {
    id: "c1",
    title: "Refactor inference loop",
    subtitle: "Streaming tokens without blocking the UI thread",
    date: "2026-06-16T14:22:00Z",
    tags: ["claude-code", "live"],
  },
  {
    id: "c2",
    title: "Vision model comparison",
    subtitle: "Benchmarking captioning quality across checkpoints",
    date: "2026-06-15T09:05:00Z",
    tags: ["cursor"],
  },
  {
    id: "c3",
    title: "RAG embeddings pipeline",
    subtitle: "Chunking strategy and vector store choice",
    date: "2026-06-14T18:40:00Z",
    tags: ["codex"],
  },
  {
    id: "c4",
    title: "Tool-calling agent draft",
    subtitle: "Wiring function schemas into the chat loop",
    date: "2026-06-13T11:15:00Z",
    tags: ["claude-code"],
  },
  {
    id: "c5",
    title: "Chain-of-thought prompts",
    subtitle: "Improving multi-step math reliability",
    date: "2026-06-11T16:50:00Z",
    tags: ["cursor"],
  },
  {
    id: "c6",
    title: "Reranker eval harness",
    subtitle: "Measuring nDCG against the baseline retriever",
    date: "2026-06-09T08:30:00Z",
    tags: ["codex"],
  },
  {
    id: "c7",
    title: "Quantization experiments",
    subtitle: "4-bit vs 8-bit latency and accuracy trade-offs",
    date: "2026-06-07T13:00:00Z",
    tags: ["claude-code"],
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
