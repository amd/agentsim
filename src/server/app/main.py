"""Entrypoint for the server daemon.

Run it as a module so the ``app`` package resolves:

    python -m app.main [--port 4317]

The order of operations is the same as any server daemon:
  1. read configuration (here: CLI flags),
  2. build the framework registry and restore the active set from disk,
  3. start listening for HTTP requests (the framework is chosen per request).
"""

import argparse
from pathlib import Path

import uvicorn

from app.registry import FrameworkRegistry
from app.server import create_app

DEFAULT_PORT = 4317


def build_registry(data_dir: str | None = None) -> FrameworkRegistry:
    """Build the framework registry and restore its active set.

    ``data_dir``, when given, is a shared root used only to seed the active set on
    first run -- each framework reads ``<data_dir>/<alias>``, and the registry's
    state file lives alongside it. When omitted, each framework falls back to its
    own default location (e.g. ClaudeCode reads ``~/.claude/projects``) and state
    is stored under ``~/.agent-sim``.
    """
    if data_dir:
        state_path = Path(data_dir) / "frameworks.json"
    else:
        state_path = Path.home() / ".agent-sim" / "frameworks.json"

    registry = FrameworkRegistry(state_path, default_data_dir=data_dir)
    registry.load()
    return registry


def main() -> None:
    parser = argparse.ArgumentParser(prog="server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--data-dir", default=None,
                        help="shared data root used to seed frameworks on first run "
                             "(each reads <data-dir>/<alias>)")
    args = parser.parse_args()

    registry = build_registry(args.data_dir)
    app = create_app(registry)

    print(f"[server] listening on http://localhost:{args.port}")
    print(f"[server] frameworks: {', '.join(sorted(registry.active)) or '(none)'}")

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
