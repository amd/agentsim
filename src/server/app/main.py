# Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
#
# See LICENSE for license information.

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


def build_registry(config_dir: str | None = None) -> FrameworkRegistry:
    """Build the framework registry and restore its active set.

    The configured data sources are persisted to ``config.json`` under
    ``config_dir`` (default: ``~/.cache/AgentSim``). The active set starts
    empty on first run; data sources are added by the user (manually or from
    auto-detection).
    """
    base = Path(config_dir) if config_dir else Path.home() / ".cache" / "AgentSim"
    state_path = base / "config.json"

    registry = FrameworkRegistry(state_path)
    registry.load()
    return registry


def main() -> None:
    parser = argparse.ArgumentParser(prog="server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--config-dir", default=None,
                        help="directory holding config.json "
                             "(default: ~/.cache/AgentSim)")
    args = parser.parse_args()

    registry = build_registry(args.config_dir)
    app = create_app(registry)

    print(f"[server] listening on http://localhost:{args.port}")
    print(f"[server] frameworks: {', '.join(sorted(registry.active)) or '(none)'}")

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
