# Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
#
# See LICENSE for license information.

"""Runtime registry of data sources.

Two layers:
  * ``AVAILABLE`` -- the catalog: every framework alias the server knows how to
    build, mapped to its class. Supporting a new tool means adding its class here.
  * ``FrameworkRegistry`` -- the *active* set of **sources**. A source is one
    (framework, path) pair where ``path`` is a folder OR a single trace file; the
    backend interprets whichever shape it's given. Sources can be added/removed at
    runtime and are persisted to a JSON file so the choice survives restarts.

Every active source is keyed by a stable id derived from its absolute path, so the
same path can't be added twice and any number of sources can share a framework.
The registry owns the ``active`` dict that ``server.py`` reads on every request,
so mutating it (add/remove) is immediately visible to all endpoints.
"""

import hashlib
import json
import os
from pathlib import Path

from app.backends.AgenticFramework import AgenticFramework
from app.backends.ClaudeCode import ClaudeCode
from app.backends.Hermes import Hermes
from app.backends.Pi import Pi

# The catalog: every framework type the server can build, keyed by alias.
AVAILABLE: dict[str, type[AgenticFramework]] = {
    cls.alias: cls for cls in (ClaudeCode, Hermes, Pi)
}


class FrameworkRegistry:
    def __init__(self, state_path: Path) -> None:
        self._state_path = state_path
        # source_id -> initialized backend
        self.active: dict[str, AgenticFramework] = {}
        # source_id -> (framework alias, resolved path), so persistence and the
        # source list can report each source without re-deriving anything.
        self._sources: dict[str, tuple[str, str]] = {}
        # True until the app finishes its first startup. Drives one-time UI (the
        # client auto-opens Manage Data Sources on first launch). A missing/absent
        # value means first startup, so it defaults to True.
        self.is_first_startup: bool = True

    # --- catalog -------------------------------------------------------------
    def available(self) -> list[type[AgenticFramework]]:
        """Every framework type that can be activated, active or not."""
        return list(AVAILABLE.values())

    # --- active set ----------------------------------------------------------
    @staticmethod
    def _source_id(path: str) -> str:
        """Stable id for a source, derived from its absolute, case-normalized
        path so re-adding the same location (even with different casing) collides
        and is rejected."""
        norm = os.path.normcase(os.path.abspath(path))
        return f"src-{hashlib.sha1(norm.encode('utf-8')).hexdigest()[:12]}"

    def get(self, source_id: str) -> AgenticFramework | None:
        return self.active.get(source_id)

    def framework_of(self, source_id: str) -> str:
        """The framework alias backing an active source (``""`` if unknown)."""
        entry = self._sources.get(source_id)
        return entry[0] if entry else ""

    def path_of(self, source_id: str) -> str:
        entry = self._sources.get(source_id)
        return entry[1] if entry else ""

    def add(self, alias: str, path: str | None = None) -> tuple[str, AgenticFramework]:
        """Activate a source: one (framework, path) pair.

        ``path`` may be a folder or a single file; ``None`` uses the framework's
        default location. Returns ``(source_id, backend)``.

        Raises ``KeyError`` if the alias is unknown, ``ValueError`` if a source
        for the same path is already active.
        """
        cls = AVAILABLE.get(alias)
        if cls is None:
            raise KeyError(alias)
        resolved = path if path else str(cls.default_data_basepath)
        source_id = self._source_id(resolved)
        if source_id in self.active:
            raise ValueError(f"source already active: {resolved}")
        framework = cls(resolved)
        framework.init()
        self.active[source_id] = framework
        self._sources[source_id] = (alias, resolved)
        self.save()
        return source_id, framework

    def remove(self, source_id: str) -> None:
        """Deactivate a source. Raises ``KeyError`` if it is not active."""
        if source_id not in self.active:
            raise KeyError(source_id)
        del self.active[source_id]
        self._sources.pop(source_id, None)
        self.save()

    # --- persistence ---------------------------------------------------------
    def load(self) -> None:
        """Restore the active sources from disk.

        The state file holds a single ``sources`` list of ``{framework, path}``.
        A legacy file (pre-unification ``active`` list of ``{alias, path}``) is
        migrated to that shape and rewritten once on load. On first run (no state
        file) the active set starts empty.
        """
        sources: list[dict] = []
        legacy: list[dict] = []
        needs_rewrite = False
        if self._state_path.exists():
            try:
                data = json.loads(self._state_path.read_text(encoding="utf-8"))
                self.is_first_startup = bool(data.get("is_first_startup", True))
                if "sources" in data:
                    sources = data.get("sources") or []
                else:
                    legacy = data.get("active") or []
                    needs_rewrite = True
            except (OSError, json.JSONDecodeError) as error:
                print(f"[registry] failed to read {self._state_path}: {error}")

        self.active.clear()
        self._sources.clear()

        # Legacy entries: {alias, path} where path=None meant the class default.
        for entry in legacy:
            alias = entry.get("alias")
            if alias not in AVAILABLE:
                print(f"[registry] skipping unknown framework: {alias}")
                continue
            try:
                self.add(alias, entry.get("path"))
            except ValueError:
                pass  # duplicate; ignore

        # New shape: {framework, path}.
        for entry in sources:
            framework = entry.get("framework")
            path = entry.get("path")
            if framework not in AVAILABLE:
                print(f"[registry] skipping unknown framework: {framework}")
                continue
            try:
                self.add(framework, path)
            except ValueError:
                pass  # duplicate; ignore

        if needs_rewrite:
            self.save()  # rewrite the migrated legacy file in the new shape

    def mark_startup_complete(self) -> None:
        """Record that the app has finished its first startup so first-run-only UI
        fires only once. Idempotent — a no-op once already cleared."""
        if not self.is_first_startup:
            return
        self.is_first_startup = False
        self.save()

    def save(self) -> None:
        payload = {
            "is_first_startup": self.is_first_startup,
            "sources": [
                {"framework": alias, "path": path}
                for alias, path in self._sources.values()
            ],
        }
        try:
            self._state_path.parent.mkdir(parents=True, exist_ok=True)
            self._state_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except OSError as error:
            print(f"[registry] failed to write {self._state_path}: {error}")
