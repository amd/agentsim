# Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
#
# See LICENSE for license information.

"""HTTP endpoints for the server (FastAPI).

``create_app`` is handed a :class:`FrameworkRegistry` holding the active sources.
A **source** is one (framework, path) pair where ``path`` is a folder OR a single
trace file. Each request names the source it wants in the path
(``/sources/{source_id}/...``); the handler looks it up and dispatches. Sources
can be added/removed at runtime via the ``/sources`` CRUD endpoints, and every
other endpoint reads the registry's live active set, so changes take effect
immediately.

The HTTP contract is the seam between client and server: the frontend (api.ts)
and the CLI both speak it, so either can be swapped without the server changing.
"""

import os
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.backends.AgenticFramework import AgenticFramework
from app.models import (
    AddSourceRequest,
    DataSource,
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
    app = FastAPI(title="AgentSim")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _source(source_id: str) -> AgenticFramework:
        backend = registry.get(source_id)
        if backend is None:
            known = ", ".join(sorted(registry.active)) or "(none)"
            raise HTTPException(status_code=404, detail=f"unknown source: {source_id} (known: {known})")
        return backend

    def _safe_sessions(backend: AgenticFramework) -> list[SessionMetadata]:
        """A backend's sessions, or ``[]`` if its path is gone/unreadable, so one
        bad source never 500s the whole sidebar."""
        try:
            return backend.get_sessions_list()
        except Exception as error:  # missing/renamed path, parse failure, etc.
            print(f"[server] source read failed for {backend.data_basepath}: {error}")
            return []

    def _prepare(
        items: list[SessionMetadata], source_id: str, backend: AgenticFramework
    ) -> list[SessionMetadata]:
        """Stamp each session with its source id + framework format alias and
        derive its display model name (the framework's prefix stripped). The
        canonical `model` is left intact so clients keep the real id (needed to
        launch the CLI); only the additive `model_display` carries the label."""
        prefix = backend.remove_model_nameprefix
        for item in items:
            item.source_id = source_id
            item.framework = backend.alias
            if prefix and item.model.startswith(prefix):
                item.model_display = item.model[len(prefix):]
            else:
                item.model_display = item.model
        return items

    def _all_sessions() -> list[SessionMetadata]:
        """Union every active source's sessions, stamping each with its source
        id and framework format alias."""
        merged: list[SessionMetadata] = []
        for source_id, backend in registry.active.items():
            merged.extend(_prepare(_safe_sessions(backend), source_id, backend))
        merged.sort(key=lambda s: s.timestamp_modified, reverse=True)
        return merged

    @app.get("/health")
    def health() -> dict[str, object]:
        return {"status": "ok", "sources": sorted(registry.active)}

    @app.get("/config")
    def get_config() -> dict[str, object]:
        """Client-facing app config. ``is_first_startup`` drives the one-time
        auto-open of Manage Data Sources on first launch."""
        return {"is_first_startup": registry.is_first_startup}

    @app.post("/config/startup-complete", status_code=204)
    def startup_complete() -> None:
        """Clear the first-startup flag once the client has handled first-run UI."""
        registry.mark_startup_complete()

    @app.get("/frameworks/available")
    def available_frameworks() -> list[DataSource]:
        """Every framework type the server can build -- the add dropdown catalog."""
        return [
            DataSource(alias=cls.alias, name=cls.name, primary_color=cls.primary_color)
            for cls in registry.available()
        ]

    @app.get("/frameworks/detected")
    def detected_frameworks() -> list[DataSource]:
        """Catalog frameworks whose default data location exists but isn't already
        an active source -- the basis for the Manage Data Sources "detected" list."""
        found: list[DataSource] = []
        for cls in registry.available():
            path = cls.detect()
            if not path:
                continue
            if registry.get(FrameworkRegistry._source_id(path)) is not None:
                continue  # default location already added as a source
            # The default location is the canonical ("*") layout: count via that
            # trusted view (fast, metadata-only) rather than a validating scan.
            probe = cls(path, "*")
            probe.init()
            found.append(DataSource(
                alias=cls.alias, name=cls.name, primary_color=cls.primary_color,
                path=path, session_count=len(_safe_sessions(probe)),
            ))
        return found

    def _source_info(source_id: str, backend: AgenticFramework) -> DataSource:
        return DataSource(
            id=source_id,
            alias=backend.alias,
            name=backend.name,
            primary_color=backend.primary_color,
            path=backend.data_basepath,
            session_count=len(_safe_sessions(backend)),
        )

    @app.get("/sources")
    def list_sources() -> list[DataSource]:
        """Every active data source (folder or file), each with its live count."""
        return [_source_info(sid, fw) for sid, fw in registry.active.items()]

    @app.post("/sources/validate")
    def validate_source(body: AddSourceRequest) -> dict[str, object]:
        """Check whether ``path`` holds readable sessions for ``framework`` before
        the user commits to adding it. One generic gate for both folders and
        single files: valid iff at least one session is found. Returns ``valid``
        plus the session count (or a human-readable ``error``)."""
        cls = AVAILABLE.get(body.framework)
        if cls is None:
            return {"valid": False, "session_count": 0, "error": f"Unknown framework: {body.framework}"}
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

    @app.post("/sources", status_code=201)
    def add_source(body: AddSourceRequest) -> DataSource:
        if body.framework not in AVAILABLE:
            known = ", ".join(sorted(AVAILABLE)) or "(none)"
            raise HTTPException(
                status_code=404,
                detail=f"unknown framework: {body.framework} (available: {known})",
            )
        # Enforce the same gate the client pre-checks with, so a source is never
        # added unless it actually yields sessions for its framework.
        result = validate_source(body)
        if not result["valid"]:
            raise HTTPException(status_code=422, detail=str(result["error"]))
        # The default location (no explicit path) is always auto-watched;
        # otherwise the client asks for watch (detected add) vs snapshot (manual).
        watch = body.watch or body.path is None
        try:
            source_id, backend = registry.add(body.framework, body.path, watch)
        except ValueError:
            raise HTTPException(status_code=409, detail="source already active for this path")
        return _source_info(source_id, backend)

    @app.delete("/sources/{source_id}", status_code=204)
    def remove_source(source_id: str) -> None:
        try:
            registry.remove(source_id)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"source not active: {source_id}")

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
            if wanted_model and s.model_display not in wanted_model:
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

        # Group by framework format so multiple sources of the same framework fold
        # into one pill (e.g. a Claude Code folder + a Claude Code file share one).
        fw_counts: dict[str, int] = {}
        for s in sessions:
            fw_counts[s.framework] = fw_counts.get(s.framework, 0) + 1
        fw_facets = []
        for alias, count in fw_counts.items():
            cls = AVAILABLE.get(alias)
            if cls is None or count == 0:
                continue
            fw_facets.append(DataSource(
                alias=alias,
                name=cls.name,
                primary_color=cls.primary_color,
                session_count=count,
            ))

        proj_counts: dict[str, int] = {}
        for s in sessions:
            proj_counts[s.project_path] = proj_counts.get(s.project_path, 0) + 1
        proj_facets = [
            ProjectFacet(path=path, name=os.path.basename(path.rstrip("/\\")) or path, count=count)
            for path, count in sorted(proj_counts.items(), key=lambda kv: kv[1], reverse=True)
        ]

        model_counts: dict[str, int] = {}
        for s in sessions:
            if s.model_display:
                model_counts[s.model_display] = model_counts.get(s.model_display, 0) + 1
        model_facets = [
            ModelFacet(name=name, count=count)
            for name, count in sorted(model_counts.items(), key=lambda kv: kv[1], reverse=True)
        ]

        return SessionFacets(frameworks=fw_facets, projects=proj_facets, models=model_facets)

    @app.get("/sources/{source_id}/sessions")
    def sessions(source_id: str) -> list[SessionMetadata]:
        backend = _source(source_id)
        return _prepare(_safe_sessions(backend), source_id, backend)

    @app.get("/sources/{source_id}/sessions/{session_id}")
    def session(source_id: str, session_id: str) -> SessionTrace:
        backend = _source(source_id)
        try:
            return backend.get_session_trace(session_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"unknown session: {session_id}")

    return app
