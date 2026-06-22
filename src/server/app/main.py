"""Entrypoint for the server daemon.

Run it as a module so the ``app`` package resolves:

    python -m app.main [--port 4317]

The order of operations is the same as any server daemon:
  1. read configuration (here: CLI flags),
  2. build every backend and initialize it once,
  3. start listening for HTTP requests (the framework is chosen per request).
"""

import argparse
from pathlib import Path

import uvicorn

from app.backends.AgenticFramework import AgenticFramework
from app.backends.ClaudeCode import ClaudeCode
from app.server import create_app

DEFAULT_PORT = 4317

# Every backend the server knows how to serve.
FRAMEWORK_CLASSES: list[type[AgenticFramework]] = [ClaudeCode]


def build_frameworks(data_dir: str | None = None) -> dict[str, AgenticFramework]:
    """Build and initialize every backend.

    When ``data_dir`` is given it's a shared root holding one subdirectory per
    framework (``<data_dir>/<alias>``); each backend reads from its own subdir.
    When omitted, each backend falls back to its own default location (e.g.
    ClaudeCode reads ``~/.claude/projects``).
    """
    frameworks: dict[str, AgenticFramework] = {}
    for cls in FRAMEWORK_CLASSES:
        root = str(Path(data_dir) / cls.alias) if data_dir else None
        framework = cls(root)
        framework.init()
        frameworks[framework.alias] = framework
    return frameworks


def main() -> None:
    parser = argparse.ArgumentParser(prog="server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--data-dir", default=None,
                        help="shared data root; each framework reads <data-dir>/<alias>")
    args = parser.parse_args()

    frameworks = build_frameworks(args.data_dir)
    app = create_app(frameworks)

    print(f"[server] listening on http://localhost:{args.port}")
    print(f"[server] frameworks: {', '.join(sorted(frameworks))}")

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
