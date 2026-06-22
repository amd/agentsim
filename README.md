# agent-sim — visualize agentic-coding sessions on a timeline

A desktop app that reads the transcripts your agentic coding tools leave behind
(Claude Code, Cursor, …) and lays each session out on a GarageBand-style
timeline of messages, thinking, and tool calls. It is **read-only**: it displays
and plays back sessions, it never modifies them.

## The shape

```
  Desktop UI (Tauri + vanilla TS) ──┐
                                     ├─ HTTP ─▶  Python server  ─▶  Registry  ─▶  Framework backends
  (browser dev: Vite) ──────────────┘            (port 4317)                     (ClaudeCode | Cursor | Codex)
```

The **server owns all data**: loading transcripts, merging across frameworks,
filtering, and sorting. The frontend is a thin view — it sends filter state and
renders whatever comes back. Adding support for another tool means adding one
backend class; nothing else changes.

| Folder | What it is |
| --- | --- |
| `src/app` | Tauri desktop app: vanilla-TS frontend (`src/`) + Rust host (`src-tauri/`) |
| `src/server` | Python/FastAPI server: HTTP API + framework registry + backends |
| `src_future/cli` | CLI client (work in progress) |
| `reference/` | Read-only design reference (Lemonade UI) — not built |
| `scripts/` | Windows launch helpers (`run_app.bat`, `run_web.bat`) |

## Frameworks (data sources)

Each backend under `src/server/app/backends/` reads one tool's sessions and
translates them into the shared wire types.

| Backend | Reads from | Status |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<project>/<id>.jsonl` | Full parsing |
| Cursor | `~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl` | Full parsing |
| Codex | `~/.codex/sessions` | Scaffold (no parsing yet) |

Data sources are managed at runtime from **File → Manage Data Sources**
(auto-detected or added by path). The active set is persisted to
`~/.cache/agent-sim/config.json`.

## Prerequisites

- **Python 3.10+** and **pip** — runs the server.
- **Node.js 20+** and **npm** — runs the frontend and the Tauri tooling.
- **Rust** — only for the full desktop app (`tauri:dev`). Not needed for the
  server or the browser workflow.
  - Install via rustup: https://rustup.rs (Windows: `winget install Rustlang.Rustup`),
    then restart your terminal and confirm `cargo --version`.
  - Windows also needs the **WebView2 runtime** (preinstalled on Win11) and the
    MSVC "Desktop development with C++" build tools.

## Setup

```bash
npm install              # frontend dependencies
npm run server:install   # installs the server's Python deps (FastAPI/uvicorn)
```

> Tip: create a virtualenv first so the server deps stay isolated —
> `python -m venv .venv`, then activate it.

## Run it — two ways

### 1. Server + UI in a browser (no Rust)

```bash
npm run dev               # starts the Python server AND the Vite frontend
# open the URL Vite prints (default http://localhost:1420)
```

### 2. Full desktop app (needs Rust)

```bash
npm run app:icons         # one time: generates app icons
npm run tauri:dev         # opens the desktop window;
                          # the Rust host launches the Python server for you
```

### Poke the API directly

```bash
npm run dev:server        # python -m app.main  (serves on :4317)
curl http://localhost:4317/health
curl http://localhost:4317/sessions
curl http://localhost:4317/sessions/facets
```

FastAPI also serves interactive API docs at http://localhost:4317/docs.

The server defaults its config to `~/.cache/agent-sim`; override with
`python -m app.main --config-dir <dir>` (and `--port`) for an isolated run.

## Key HTTP endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /sessions` | Merged, sorted session list. Filters: `framework`, `model`, `project`, `live`, `from`/`to` (all optional) |
| `GET /sessions/facets` | Distinct frameworks / models / projects with counts, for the filter UI |
| `GET /frameworks` | Active data sources |
| `GET /frameworks/detected` | Auto-detected, not-yet-active sources |
| `POST /frameworks/validate` | Check a path holds readable sessions before adding |
| `POST /frameworks` · `DELETE /frameworks/{alias}` | Add / remove a data source |
| `GET /frameworks/{alias}/sessions/{id}` | Full span trace for one session |

## Handy scripts

| Script | Does |
| --- | --- |
| `npm run server:install` | Install the server's Python deps. |
| `npm run dev:server` | Run the Python/FastAPI server. |
| `npm run dev:app` | Run only the Vite frontend. |
| `npm run dev` | Run server + frontend together. |
| `npm run tauri:dev` | Run the full desktop app (Rust host spawns the server). |
| `npm run typecheck` | Type-check the TS workspaces. |
| `npm run build` | Build the frontend (tsc + Vite). |
