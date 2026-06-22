"""HTTP endpoints for the server (FastAPI).

``create_app`` is handed a registry of already-initialized backends, keyed by
their alias. Each request names the framework it wants in the path
(``/frameworks/{framework}/...``); the handler looks it up and dispatches. The
backends are initialized once at startup -- nothing is reloaded per request.

The HTTP contract is the seam between client and server: the frontend (api.ts)
and the CLI both speak it, so either can be swapped without the server changing.
"""

import os
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.backends.AgenticFramework import AgenticFramework
from app.models import (
    FrameworkFacet,
    ProjectFacet,
    SessionFacets,
    SessionMetadata,
    SessionTrace,
)


def _csv(value: str | None) -> set[str]:
    """Split a comma-separated query param into a set, dropping blanks."""
    if not value:
        return set()
    return {part.strip() for part in value.split(",") if part.strip()}


def _parse_ts(timestamp: str) -> datetime | None:
    if not timestamp:
        return None
    try:
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return None


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

    def _all_sessions() -> list[SessionMetadata]:
        """Union every backend's sessions, stamping each with its framework alias."""
        merged: list[SessionMetadata] = []
        for alias, backend in frameworks.items():
            for item in backend.get_sessions_list():
                item.framework = alias
                merged.append(item)
        merged.sort(key=lambda s: s.timestamp_modified, reverse=True)
        return merged

    @app.get("/health")
    def health() -> dict[str, object]:
        return {"status": "ok", "frameworks": sorted(frameworks)}

    @app.get("/frameworks")
    def list_frameworks() -> list[dict[str, str]]:
        return [{"alias": alias, "name": fw.name} for alias, fw in frameworks.items()]

    @app.get("/sessions")
    def list_sessions(
        framework: str | None = Query(default=None, description="CSV of framework aliases"),
        live: bool | None = Query(default=None),
        project: str | None = Query(default=None, description="CSV of full project paths"),
        from_: str | None = Query(default=None, alias="from", description="ISO instant"),
        to: str | None = Query(default=None, description="ISO instant"),
    ) -> list[SessionMetadata]:
        wanted_fw = _csv(framework)
        wanted_proj = _csv(project)
        ts_from = _parse_ts(from_ or "")
        ts_to = _parse_ts(to or "")

        result: list[SessionMetadata] = []
        for s in _all_sessions():
            if wanted_fw and s.framework not in wanted_fw:
                continue
            if live is not None and s.is_live != live:
                continue
            if wanted_proj and s.project_path not in wanted_proj:
                continue
            if ts_from or ts_to:
                ts = _parse_ts(s.timestamp_modified)
                if ts is None:
                    continue
                if ts_from and ts < ts_from:
                    continue
                if ts_to and ts >= ts_to:
                    continue
            result.append(s)
        return result

    @app.get("/sessions/facets")
    def session_facets() -> SessionFacets:
        sessions = _all_sessions()

        fw_counts: dict[str, int] = {}
        for s in sessions:
            fw_counts[s.framework] = fw_counts.get(s.framework, 0) + 1
        fw_facets = [
            FrameworkFacet(
                alias=alias,
                name=frameworks[alias].name if alias in frameworks else alias,
                count=fw_counts.get(alias, 0),
            )
            for alias in frameworks
            if fw_counts.get(alias, 0) > 0
        ]

        proj_counts: dict[str, int] = {}
        for s in sessions:
            proj_counts[s.project_path] = proj_counts.get(s.project_path, 0) + 1
        proj_facets = [
            ProjectFacet(path=path, name=os.path.basename(path.rstrip("/\\")) or path, count=count)
            for path, count in sorted(proj_counts.items(), key=lambda kv: kv[1], reverse=True)
        ]

        return SessionFacets(frameworks=fw_facets, projects=proj_facets)

    @app.get("/frameworks/{framework}/sessions")
    def sessions(framework: str) -> list[SessionMetadata]:
        backend = _framework(framework)
        items = backend.get_sessions_list()
        for item in items:
            item.framework = framework
        return items

    @app.get("/frameworks/{framework}/sessions/{session_id}")
    def session(framework: str, session_id: str) -> SessionTrace:
        backend = _framework(framework)
        try:
            return backend.get_session_trace(session_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"unknown session: {session_id}")

    return app
