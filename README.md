# AgentSim — see and understand your agents

![main_screen.png](doc/main_screen.png)

AgentSim is a ModelSim-inspired tool that helps to visualize, debug, and better understand AI agent behavior, providing deeper visual insights into how agents
 execute tasks and make decisions.

It reads the transcripts your agentic coding tools leave behind and lays
each session out on a timeline of messages, thinking, and tool
calls. See how a session actually unfolded — what the agent read, when it
thought, which tools it fired, and how long each step took.

## Data sources

AgentSim reads sessions straight from where your tools already store them —
nothing to export or configure.

| Source | Reads from | Status |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<project>/<id>.jsonl` | Supported |
| Hermes | `~/.hermes/state.db` (`%LOCALAPPDATA%\hermes\state.db` on Windows) | Supported |
| Pi | `~/.pi/agent/sessions/<project>/<id>.jsonl` | Supported |

### Adding data sources

Add data one of three ways (examples shown for Claude Code):

- **Single file** — one `.jsonl` transcript.
  - `D:\mydata\6f3a…jsonl`
- **Folder of transcripts** — a flat folder of `.jsonl` files.
    ```
    other_sessions/
    └── session-a.jsonl
        …
    ```
- **Canonical file layout** — a folder organized the way the framework stores it
  (the nested subtree), at any location — not just the default one.
  - `my/custom/path/.claude/`

**Simply drag and drop your data in the app UI, or go to file → Manage Data Sources.**

## Getting started

1. Download the latest Windows release from the **Releases** section in the
   sidebar on the right.
2. Run the installer.
   - You will see **"Windows protected your PC"** — click **More info → Run anyway**.
   - This appears because the app is not yet signed. It's open source, so feel
     free to audit the code.
3. Select the data sources you would like to view.

> **Windows only** for now — other platforms will be supported soon.

## For developers

Run AgentSim locally from source.

### Prerequisites
- **Node.js 20+** (provides `npm`)
- **Rust toolchain** (`cargo`) — required for the Tauri desktop host
- **Python 3.11+** — required for the FastAPI backend

### Setup
```bash
git clone https://github.com/amd/agentsim.git
cd agentsim

npm install            # installs frontend + Tauri CLI (npm workspace)
npm run server:install # installs the Python server dependencies
npm run app:icons      # generates the Tauri app icons (not committed to git)
```

### Run
From the repo root:

```bash
# Desktop app (native Tauri window) — the Rust host starts/stops the Python server itself
scripts\run_app.bat        # or: npm run tauri:dev

# Web mode (FastAPI server + Vite UI in the browser at http://localhost:1420)
scripts\run_web.bat        # or: npm run dev
```

> The first `run_app` launch is slow — Cargo compiles the Rust `src-tauri`
> crate from scratch. Later runs are cached and fast.

## Future direction
- Extending support to Gaia, Cursor, Codex, and OpenCode
- Adding session analysis and stats with AI-driven analytics
- Cross-platform support beyond Windows