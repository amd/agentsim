"""HTTP endpoints for the server (FastAPI).

``create_app`` is handed a registry of already-initialized backends, keyed by
their alias. Each request names the framework it wants in the path
(``/frameworks/{framework}/...``); the handler looks it up and dispatches. The
backends are initialized once at startup -- nothing is reloaded per request.

The HTTP contract is the seam between client and server: the frontend (api.ts)
and the CLI both speak it, so either can be swapped without the server changing.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.backends.AgenticFramework import AgenticFramework
from app.models import SessionInfo, SessionTrace


def create_app(frameworks: dict[str, AgenticFramework]) -> FastAPI:
    app = FastAPI(title="agent-sim")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _framework(alias: str) -> AgenticFramework:
        backend = frameworks.get(alias)
        if backend is None:
            known = ", ".join(sorted(frameworks)) or "(none)"
            raise HTTPException(status_code=404, detail=f"unknown framework: {alias} (known: {known})")
        return backend

    @app.get("/health")
    def health() -> dict[str, object]:
        return {"status": "ok", "frameworks": sorted(frameworks)}

    @app.get("/frameworks")
    def list_frameworks() -> list[dict[str, str]]:
        return [{"alias": alias, "name": fw.name} for alias, fw in frameworks.items()]

    @app.get("/frameworks/{framework}/sessions")
    def sessions(framework: str) -> list[SessionInfo]:
        return _framework(framework).get_sessions_list()

    @app.get("/frameworks/{framework}/sessions/{session_id}")
    def session(framework: str, session_id: str) -> SessionTrace:
        backend = _framework(framework)
        try:
            return backend.get_session_trace(session_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"unknown session: {session_id}")

    return app
