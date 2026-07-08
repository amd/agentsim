# AgentSim — visualize your agentic-coding sessions on a timeline

![main_screen.png](doc/main_screen.png)

AgentSim reads the transcripts your agentic coding tools leave behind and lays
each session out on a timeline of messages, thinking, and tool
calls. See how a session actually unfolded — what the agent read, when it
thought, which tools it fired, and how long each step took.

## Data sources

AgentSim reads sessions straight from where your tools already store them —
nothing to export or configure.

| Source | Reads from | Status |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<project>/<id>.jsonl` | Supported |
| Codex | `~/.codex/sessions` | Work in progress |
| Cursor | `~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl` | Work in progress |
| PIAgent | — | Work in progress |

## Getting started

1. Download the latest Windows release from the **Releases** section in the
   sidebar on the right.
2. Run the installer. 
3. Select the data sources you would like to view.

> **Windows only** for now — other platforms will be supported soon.

## Future direction
- Extending support to Hermes, Gaia, Pi, Cursor
- Adding session analysis/stats with AI Analytics
- 