"""HTTP endpoints for the server (FastAPI).

``create_app`` wires HTTP routes straight to the active backend -- the REST
surface of the daemon. Each handler pulls input from the request, calls the
backend, and translates the result back into an HTTP response.

The HTTP contract is the seam between client and server: the frontend (api.ts)
and the CLI both speak it, so either can be swapped without the server changing.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.backends.AgenticFramework import AgenticFramework
from app.models import SessionTraceData


def create_app(framework: AgenticFramework) -> FastAPI:
    app = FastAPI(title="agent-sim")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "backend": framework.name}

    @app.get("/sessions")
    def sessions() -> list[str]:
        return framework.get_sessions_list()

    @app.get("/sessions/{session_id}")
    def session(session_id: str) -> SessionTraceData:
        try:
            return framework.get_session_trace_data(session_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"unknown session: {session_id}")

    return app
