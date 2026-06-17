import argparse
from pathlib import Path

import uvicorn

from app.server import create_app

DEFAULT_PORT = 4317

def main() -> None:
    parser = argparse.ArgumentParser(prog="server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    app = create_app()

    print(f"[server] listening on http://localhost:{args.port}")

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
