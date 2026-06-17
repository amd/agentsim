"""Entrypoint for the server daemon.

Run it as a module so the ``app`` package resolves:

    python -m app.main [--port 4317]

The order of operations is the same as any server daemon:
  1. read configuration (here: CLI flags),
  2. build every backend and initialize it once,
  3. start listening for HTTP requests (the framework is chosen per request).
"""

import argparse

import uvicorn

from app.backends.AgenticFramework import AgenticFramework
from app.backends.ClaudeCode import ClaudeCode
from app.server import create_app

DEFAULT_PORT = 4317

# Every backend the server knows how to serve.
FRAMEWORK_CLASSES: list[type[AgenticFramework]] = [ClaudeCode]


def build_frameworks() -> dict[str, AgenticFramework]:
    frameworks: dict[str, AgenticFramework] = {}
    for cls in FRAMEWORK_CLASSES:
        framework = cls()
        framework.init()
        frameworks[framework.alias] = framework
    return frameworks


def main() -> None:
    parser = argparse.ArgumentParser(prog="server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    frameworks = build_frameworks()
    app = create_app(frameworks)

    print(f"[server] listening on http://localhost:{args.port}")
    print(f"[server] frameworks: {', '.join(sorted(frameworks))}")

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
