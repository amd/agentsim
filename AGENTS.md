# AGENTS.md

Guidance for AI agents working in this repository.

## Project Overview

**agent-sim** is a read-only desktop app that visualizes agentic-coding session
transcripts (Claude Code, Cursor, …) on a GarageBand-style timeline of messages,
thinking, and tool calls. A Python/FastAPI server reads the transcripts and owns
all data handling; a Tauri + vanilla-TypeScript frontend renders what the server
returns.

## Hard Constraints (do not violate)

1. **No frontend framework.** The UI is **vanilla TypeScript** — no React, Vue,
   Svelte, JSX, or virtual DOM. Build UI with the `el(tag, attrs, children)` and
   `clear(node)` helpers in `src/app/src/ui/dom.ts`; components are plain
   functions that return `HTMLElement`s.
2. **Read-only app.** It displays and plays back sessions; it never creates,
   edits, or deletes a user's transcripts.
3. **`reference/` is off-limits.** `reference/lemonade` is the design reference
   only. Never edit it; read it to match UI patterns and `.lm-*` classes.
4. **Backend owns the data flow.** All loading, merging, filtering, and sorting
   happens server-side. The frontend sends filter state and renders the result —
   no client-side filtering of an in-memory list.
5. **Scope discipline.** Change only what the task asks for. Don't strip or
   refactor adjacent code on your own judgment.

## Architecture

```
  Desktop UI (Tauri + vanilla TS) ──┐
                                     ├─ HTTP ─▶  FastAPI server  ─▶  Registry  ─▶  Framework backends
  (browser dev: Vite) ──────────────┘            (port 4317)                     (ClaudeCode | Cursor | Codex)
```

- **Server** (`src/server/app/`): `server.py` defines the HTTP endpoints,
  `registry.py` holds the active backend set (the catalog `AVAILABLE` vs the
  mutable active dict), `models.py` defines the wire types, `main.py` is the
  entrypoint.
- **Backends** (`src/server/app/backends/`): each subclass of
  `AgenticFramework` reads one tool's sessions. Implement `init()`,
  `get_sessions_list()`, `get_session_trace()`; set the class attributes
  (`name`, `alias`, `default_data_basepath`, `primary_color`,
  `remove_model_nameprefix`). Register it in `registry.py`'s `AVAILABLE`.
- **Frontend** (`src/app/src/`): `data/api.ts` is the HTTP client; `ui/*.ts` are
  the components (`Sidebar`, `FilterPanel`, `Canvas`, `DataSourcesModal`,
  `ConversationBlock`, `MenuBar`, `AppShell`); `styles/` holds CSS.
- **Host** (`src/app/src-tauri/src/`): `server_process.rs` spawns the Python
  server; `lib.rs` wires Tauri plugins.

## Key Invariants

1. **`models.py` field names ARE the wire contract.** The frontend (`api.ts`)
   and CLI depend on the exact JSON keys. New fields must be additive (have
   defaults); don't rename existing ones.
2. **Preserve core parsing logic.** Don't rewrite `_build_timeline`,
   `_parse_session_file`, or the `Span`/`SpanType`/`SessionTrace`/
   `SessionMetadata` shapes. Extend additively.
3. **Backend-owned config stays on the server.** Brand colors
   (`primary_color`), model-name prefix stripping (`remove_model_nameprefix`),
   etc. are resolved server-side; the frontend renders whatever it's given and
   hardcodes no per-framework values.
4. **Active data sources persist** to `~/.cache/agent-sim/config.json`. The
   frontend mutates the set via the `/frameworks` CRUD endpoints and refreshes on
   the `frameworks:changed` window event.
5. **No color literals in CSS.** Use the `var(--token)` design tokens from
   `src/app/src/styles/tokens.css`.

## Cross-component communication

The frontend uses `window` `CustomEvent`s instead of a state library:
`frameworks:changed` (active set changed), `view:*` (panel visibility toggles),
`file:manage-data-sources` (open the data-sources modal).

## Build & Run

```bash
npm install                # frontend deps
npm run server:install     # server Python deps (FastAPI/uvicorn/pydantic)

npm run dev                # server + Vite frontend (browser dev, no Rust)
npm run tauri:dev          # full desktop app (Rust host spawns the server)
npm run dev:server         # server only (python -m app.main, :4317)

npm run typecheck          # tsc over the TS workspaces
npm run build              # frontend build: tsc && vite build
```

Always run `npm run build` (or `typecheck`) after frontend changes — it runs
`tsc`, which is the type gate.

### Verifying server changes

The desktop app may already hold port 4317 with stale code. For a clean check,
run an isolated instance on a spare port with a temp config:

```bash
cd src/server && python -m app.main --port 4421 --config-dir "$(mktemp -d)"
curl localhost:4421/sessions
```

`TestClient` needs `httpx`; prefer `curl` against a running instance.

## Code Style

- **TypeScript**: vanilla TS + the `el()` DOM helper. Functions return
  `HTMLElement`s. Reuse `.lm-*` classes and design tokens.
- **Python**: 3.10+, type hints, Pydantic v2 models (fields without defaults
  raise `ValidationError`). 4-space indent.
- **Comments**: explain *why*, not *what*. Default to none unless a constraint or
  non-obvious invariant needs recording.

## Adding support for a new tool

1. Add `src/server/app/backends/<Tool>.py` subclassing `AgenticFramework`.
2. Parse its transcripts into `SessionMetadata` (list) and `SessionTrace`
   (spans). Synthesize timing only if the source lacks timestamps.
3. Register the class in `registry.py`'s `AVAILABLE`.
4. It now appears in detect/validate/add and the filter facets automatically —
   no frontend changes needed.
