"""HTTP endpoints for the server (FastAPI).

``create_app`` is handed a :class:`FrameworkRegistry` holding the active backends.
Each request names the framework it wants in the path
(``/frameworks/{framework}/...``); the handler looks it up and dispatches.
Frameworks (data sources) can be added/removed at runtime via the
``/frameworks`` CRUD endpoints, and every other endpoint reads the registry's
live active set, so changes take effect immediately.

The HTTP contract is the seam between client and server: the frontend (api.ts)
and the CLI both speak it, so either can be swapped without the server changing.
"""

import os
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.backends.AgenticFramework import AgenticFramework
from app.models import (
    AddFrameworkRequest,
    FrameworkInfo,
    ModelFacet,
    ProjectFacet,
    SessionFacets,
    SessionMetadata,
    SessionTrace,
)
from app.registry import AVAILABLE, FrameworkRegistry


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


def create_app(registry: FrameworkRegistry) -> FastAPI:
    app = FastAPI(title="agent-sim")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _framework(alias: str) -> AgenticFramework:
        backend = registry.get(alias)
        if backend is None:
            known = ", ".join(sorted(registry.active)) or "(none)"
            raise HTTPException(status_code=404, detail=f"unknown framework: {alias} (known: {known})")
        return backend

    def _prepare(
        items: list[SessionMetadata], alias: str, backend: AgenticFramework
    ) -> list[SessionMetadata]:
        """Stamp each session with its framework alias and apply the framework's
        model-name prefix stripping. Keeps this normalization on the server so
        clients display whatever they're given."""
        prefix = backend.remove_model_nameprefix
        for item in items:
            item.framework = alias
            if prefix and item.model.startswith(prefix):
                item.model = item.model[len(prefix):]
        return items

    def _all_sessions() -> list[SessionMetadata]:
        """Union every active backend's sessions, stamping each with its alias."""
        merged: list[SessionMetadata] = []
        for alias, backend in registry.active.items():
            merged.extend(_prepare(backend.get_sessions_list(), alias, backend))
        merged.sort(key=lambda s: s.timestamp_modified, reverse=True)
        return merged

    @app.get("/health")
    def health() -> dict[str, object]:
        return {"status": "ok", "frameworks": sorted(registry.active)}

    @app.get("/frameworks")
    def list_frameworks() -> list[FrameworkInfo]:
        """The active frameworks (data sources) currently being served."""
        return [
            FrameworkInfo(
                alias=alias,
                name=fw.name,
                data_basepath=fw.data_basepath,
                session_count=len(fw.get_sessions_list()),
                primary_color=fw.primary_color,
            )
            for alias, fw in registry.active.items()
        ]

    @app.get("/frameworks/available")
    def available_frameworks() -> list[FrameworkInfo]:
        """Every framework type the server can build, active or not."""
        return [
            FrameworkInfo(alias=cls.alias, name=cls.name, primary_color=cls.primary_color)
            for cls in registry.available()
        ]

    @app.get("/frameworks/detected")
    def detected_frameworks() -> list[FrameworkInfo]:
        """Catalog frameworks whose default data location exists but that aren't
        active yet -- the basis for the Manage Data Sources "detected" list."""
        found: list[FrameworkInfo] = []
        for cls in registry.available():
            if cls.alias in registry.active:
                continue
            path = cls.detect()
            if not path:
                continue
            probe = cls(path)
            probe.init()
            found.append(FrameworkInfo(
                alias=cls.alias, name=cls.name, primary_color=cls.primary_color,
                data_basepath=path, session_count=len(probe.get_sessions_list()),
            ))
        return found

    @app.post("/frameworks/validate")
    def validate_framework(body: AddFrameworkRequest) -> dict[str, object]:
        """Check whether ``path`` holds readable sessions for ``alias`` before the
        user commits to adding it. Returns ``valid`` plus the session count (or a
        human-readable ``error`` when it isn't a usable data source)."""
        cls = AVAILABLE.get(body.alias)
        if cls is None:
            return {"valid": False, "session_count": 0, "error": f"Unknown framework: {body.alias}"}
        try:
            probe = cls(body.path)
            probe.init()
            count = len(probe.get_sessions_list())
        except Exception as error:  # any read/parse failure means the path is unusable
            return {"valid": False, "session_count": 0, "error": str(error)}
        if count == 0:
            return {
                "valid": False,
                "session_count": 0,
                "error": f"No {cls.name} sessions found at this path.",
            }
        return {"valid": True, "session_count": count, "error": ""}

    @app.post("/frameworks", status_code=201)
    def add_framework(body: AddFrameworkRequest) -> FrameworkInfo:
        if body.alias not in AVAILABLE:
            known = ", ".join(sorted(AVAILABLE)) or "(none)"
            raise HTTPException(
                status_code=404,
                detail=f"unknown framework: {body.alias} (available: {known})",
            )
        try:
            fw = registry.add(body.alias, body.path)
        except ValueError:
            raise HTTPException(status_code=409, detail=f"framework already active: {body.alias}")
        return FrameworkInfo(
            alias=body.alias,
            name=fw.name,
            data_basepath=fw.data_basepath,
            session_count=len(fw.get_sessions_list()),
            primary_color=fw.primary_color,
        )

    @app.delete("/frameworks/{alias}", status_code=204)
    def remove_framework(alias: str) -> None:
        try:
            registry.remove(alias)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"framework not active: {alias}")

    @app.get("/sessions")
    def list_sessions(
        framework: str | None = Query(default=None, description="CSV of framework aliases"),
        live: bool | None = Query(default=None),
        project: str | None = Query(default=None, description="CSV of full project paths"),
        model: str | None = Query(default=None, description="CSV of model names"),
        from_: str | None = Query(default=None, alias="from", description="ISO instant"),
        to: str | None = Query(default=None, description="ISO instant"),
    ) -> list[SessionMetadata]:
        wanted_fw = _csv(framework)
        wanted_proj = _csv(project)
        wanted_model = _csv(model)
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
            if wanted_model and s.model not in wanted_model:
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
            FrameworkInfo(
                alias=alias,
                name=registry.active[alias].name,
                primary_color=registry.active[alias].primary_color,
                data_basepath=registry.active[alias].data_basepath,
                session_count=fw_counts.get(alias, 0),
            )
            for alias in registry.active
            if fw_counts.get(alias, 0) > 0
        ]

        proj_counts: dict[str, int] = {}
        for s in sessions:
            proj_counts[s.project_path] = proj_counts.get(s.project_path, 0) + 1
        proj_facets = [
            ProjectFacet(path=path, name=os.path.basename(path.rstrip("/\\")) or path, count=count)
            for path, count in sorted(proj_counts.items(), key=lambda kv: kv[1], reverse=True)
        ]

        model_counts: dict[str, int] = {}
        for s in sessions:
            if s.model:
                model_counts[s.model] = model_counts.get(s.model, 0) + 1
        model_facets = [
            ModelFacet(name=name, count=count)
            for name, count in sorted(model_counts.items(), key=lambda kv: kv[1], reverse=True)
        ]

        return SessionFacets(frameworks=fw_facets, projects=proj_facets, models=model_facets)

    @app.get("/frameworks/{framework}/sessions")
    def sessions(framework: str) -> list[SessionMetadata]:
        backend = _framework(framework)
        return _prepare(backend.get_sessions_list(), framework, backend)

    @app.get("/frameworks/{framework}/sessions/{session_id}")
    def session(framework: str, session_id: str) -> SessionTrace:
        backend = _framework(framework)
        try:
            return backend.get_session_trace(session_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"unknown session: {session_id}")

    return app
