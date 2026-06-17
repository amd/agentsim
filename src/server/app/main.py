"""Entrypoint for the server daemon.

Run it as a module so the ``app`` package resolves:

    python -m app.main [--port 4317]

The order of operations is the same as any server daemon:
  1. read configuration (here: CLI flags),
  2. build the backend and initialize it,
  3. start listening for HTTP requests.
"""

import argparse

import uvicorn

from app.backends.ClaudeCode import ClaudeCode
from app.server import create_app

DEFAULT_PORT = 4317


def main() -> None:
    parser = argparse.ArgumentParser(prog="server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    framework = ClaudeCode()
    framework.init()

    app = create_app(framework)

    print(f"[server] listening on http://localhost:{args.port}")
    print(f"[server] backend: {framework.name}")

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
