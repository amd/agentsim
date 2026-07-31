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

# On-disk config schema version. Bump when the config shape changes in a way
# older/newer code can't read. `load()` migrates a known-older config forward;
# a config it can't understand (a version from the future, or an unrecognized
# shape) is backed up and reset so a stale file never blocks startup.
#   v1 -- pre-children: {framework, path} entries, or a top-level `active` list.
#   v2 -- current: {framework, parent, children} entries under `sources`.
CONFIG_VERSION = 2


class FrameworkRegistry:
    def __init__(self, state_path: Path) -> None:
        self._state_path = state_path
        # source_id -> initialized backend
        self.active: dict[str, AgenticFramework] = {}
        # source_id -> (framework alias, parent path, children). ``children`` is
        # "*" (auto-watch every parseable file under the parent) or an explicit
        # list of paths relative to the parent (a frozen snapshot). Kept so
        # persistence and the source list report each source without re-deriving.
        self._sources: dict[str, tuple[str, str, str | list[str]]] = {}
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
    def _source_id(parent: str) -> str:
        """Stable id for a source, derived from its absolute, case-normalized
        parent path. Keying on the parent means re-importing files from the same
        folder collides with the existing source and merges into it rather than
        creating a duplicate."""
        norm = os.path.normcase(os.path.abspath(parent))
        return f"src-{hashlib.sha1(norm.encode('utf-8')).hexdigest()[:12]}"

    def get(self, source_id: str) -> AgenticFramework | None:
        return self.active.get(source_id)

    def framework_of(self, source_id: str) -> str:
        """The framework alias backing an active source (``""`` if unknown)."""
        entry = self._sources.get(source_id)
        return entry[0] if entry else ""

    def path_of(self, source_id: str) -> str:
        """The parent path of an active source (``""`` if unknown)."""
        entry = self._sources.get(source_id)
        return entry[1] if entry else ""

    def children_of(self, source_id: str) -> str | list[str]:
        """The tracked children of an active source (``"*"`` or a list)."""
        entry = self._sources.get(source_id)
        return entry[2] if entry else "*"

    @staticmethod
    def _resolve_membership(
        cls: type[AgenticFramework], path: str, watch: bool
    ) -> tuple[str, str | list[str]]:
        """Turn a user-supplied path into ``(parent, children)``.

        * Non-snapshot frameworks (Hermes) -> the path with ``"*"`` (whole db).
        * A single file -> its folder as parent, that one file as the child.
        * A folder added via detect/default (``watch``) -> ``"*"`` (auto-watch).
        * A folder added manually -> a frozen snapshot of its files right now.
        """
        if not cls.supports_snapshot:
            return path, "*"
        if os.path.isfile(path):
            return os.path.dirname(path), [os.path.basename(path)]
        if watch:
            return path, "*"
        probe = cls(path)
        probe.init()
        return path, probe.discover_relative()

    def _activate(
        self, alias: str, parent: str, children: str | list[str]
    ) -> tuple[str, AgenticFramework]:
        """Instantiate + register a source for ``(alias, parent, children)``,
        replacing any existing backend at the same parent. Does not persist."""
        cls = AVAILABLE[alias]
        source_id = self._source_id(parent)
        framework = cls(parent, children)
        framework.init()
        self.active[source_id] = framework
        self._sources[source_id] = (alias, parent, children)
        return source_id, framework

    def add(
        self, alias: str, path: str | None = None, watch: bool = False
    ) -> tuple[str, AgenticFramework]:
        """Activate a source, or merge into an existing one at the same parent.

        ``path`` may be a folder or a single file; ``None`` uses the framework's
        default location (implicitly watched). ``watch`` stores ``children="*"``
        (auto-absorb new files) rather than freezing a snapshot. Returns
        ``(source_id, backend)``.

        Raises ``KeyError`` if the alias is unknown, ``ValueError`` if the source
        is already active with nothing new to add (duplicate) or if a different
        framework already owns that parent.
        """
        cls = AVAILABLE.get(alias)
        if cls is None:
            raise KeyError(alias)
        resolved = path if path else str(cls.default_data_basepath)
        parent, children = self._resolve_membership(cls, resolved, watch or path is None)
        source_id = self._source_id(parent)

        existing = self._sources.get(source_id)
        if existing is not None:
            ex_alias, _, ex_children = existing
            if ex_alias != alias:
                raise ValueError(f"parent already used by {ex_alias}: {parent}")
            children = self._merge_children(ex_children, children)  # raises if nothing new

        self._activate(alias, parent, children)
        self.save()
        return source_id, self.active[source_id]

    @staticmethod
    def _merge_children(
        existing: str | list[str], incoming: str | list[str]
    ) -> str | list[str]:
        """Combine an existing source's children with an incoming import.

        Raises ``ValueError`` when the import adds nothing (a true duplicate)."""
        if existing == "*":
            raise ValueError("source already active")  # already watching everything
        if incoming == "*":
            return "*"  # upgrade a snapshot to auto-watch
        union = list(dict.fromkeys([*existing, *incoming]))  # order-stable dedupe
        if len(union) == len(existing):
            raise ValueError("source already active")  # no new files
        return union

    def remove(self, source_id: str) -> None:
        """Deactivate a source. Raises ``KeyError`` if it is not active."""
        if source_id not in self.active:
            raise KeyError(source_id)
        del self.active[source_id]
        self._sources.pop(source_id, None)
        self.save()

    # --- persistence ---------------------------------------------------------
    def _reset_stale_config(self, reason: str) -> None:
        """Back up an unreadable/incompatible config out of the way and start
        fresh, so a stale file from another app version never blocks startup.

        The bad file is renamed to ``config.json.bak`` (overwriting any prior
        backup) rather than hard-deleted, so the user's configured sources can
        still be recovered by hand. The active set is left empty for this run.
        """
        backup = self._state_path.with_suffix(self._state_path.suffix + ".bak")
        try:
            os.replace(self._state_path, backup)
            print(f"[registry] stale config ({reason}); backed up to {backup}")
        except OSError as error:
            print(f"[registry] stale config ({reason}); failed to back up: {error}")

    def load(self) -> None:
        """Restore the active sources from disk.

        The state file is a ``{version, is_first_startup, sources}`` document
        where each source is ``{framework, parent, children}`` (schema
        :data:`CONFIG_VERSION`). Two older shapes are migrated and rewritten once
        on load:
          * ``{framework, path}`` (pre-children) -- a file becomes ``parent`` +
            a one-item child list; a folder becomes ``parent`` + ``"*"``.
          * a top-level ``active`` list of ``{alias, path}`` (pre-unification).
        A config we can't understand -- corrupt JSON, a version newer than this
        build, or an unrecognized shape -- is backed up and reset (see
        :meth:`_reset_stale_config`) rather than crashing startup. On first run
        (no state file) the active set starts empty.
        """
        self.active.clear()
        self._sources.clear()

        if not self._state_path.exists():
            return

        try:
            data = json.loads(self._state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            self._reset_stale_config(f"unreadable: {error}")
            return
        if not isinstance(data, dict):
            self._reset_stale_config("not a JSON object")
            return

        # A version stamp from a newer build means a shape this code can't read;
        # reset instead of guessing. Files predating the stamp have no `version`.
        version = data.get("version")
        if isinstance(version, int) and version > CONFIG_VERSION:
            self._reset_stale_config(f"version {version} newer than {CONFIG_VERSION}")
            return

        self.is_first_startup = bool(data.get("is_first_startup", True))

        # Pick the shape. `sources` is the current (v2) list; a top-level
        # `active` list is the pre-unification (v1) legacy shape. Anything else
        # is unrecognized -> reset.
        sources: list[dict] = []
        legacy: list[dict] = []
        needs_rewrite = version != CONFIG_VERSION  # stamp missing/older -> rewrite
        if "sources" in data:
            sources = data.get("sources") or []
        elif "active" in data:
            legacy = data.get("active") or []
        else:
            self._reset_stale_config("no recognizable sources")
            return

        # Legacy entries: {alias, path} where path=None meant the class default.
        for entry in legacy:
            alias = entry.get("alias")
            if alias not in AVAILABLE:
                print(f"[registry] skipping unknown framework: {alias}")
                continue
            try:
                self.add(alias, entry.get("path"), watch=True)
            except Exception as error:  # duplicate or bad path
                print(f"[registry] skipping unloadable source {alias}: {error}")

        for entry in sources:
            try:
                self._load_source_entry(entry)
            except Exception as error:  # one bad entry never fails the rest
                print(f"[registry] skipping unloadable source {entry!r}: {error}")

        if needs_rewrite:
            self.save()  # rewrite migrated/unstamped state in the current shape

    def _load_source_entry(self, entry: dict) -> None:
        """Activate one persisted source, migrating the pre-children shape.

        Raises on a malformed entry so :meth:`load` can skip it without aborting
        the rest of the config."""
        framework = entry.get("framework")
        if framework not in AVAILABLE:
            print(f"[registry] skipping unknown framework: {framework}")
            return
        if "parent" in entry:
            parent, children = entry["parent"], entry.get("children", "*")
        else:
            # Migrate the pre-children {framework, path} shape. A dead path
            # can't be stat'd, so classify by extension.
            path = entry.get("path") or str(AVAILABLE[framework].default_data_basepath)
            if path.endswith((".jsonl", ".json")):
                parent, children = os.path.dirname(path), [os.path.basename(path)]
            else:
                parent, children = path, "*"

        # Two legacy file-sources in one folder collapse into one source.
        prior = self._sources.get(self._source_id(parent))
        if prior is not None and prior[0] == framework:
            try:
                children = self._merge_children(prior[2], children)
            except ValueError:
                return  # nothing new to add
        self._activate(framework, parent, children)

    def mark_startup_complete(self) -> None:
        """Record that the app has finished its first startup so first-run-only UI
        fires only once. Idempotent — a no-op once already cleared."""
        if not self.is_first_startup:
            return
        self.is_first_startup = False
        self.save()

    def save(self) -> None:
        payload = {
            "version": CONFIG_VERSION,
            "is_first_startup": self.is_first_startup,
            "sources": [
                {"framework": alias, "parent": parent, "children": children}
                for alias, parent, children in self._sources.values()
            ],
        }
        try:
            self._state_path.parent.mkdir(parents=True, exist_ok=True)
            self._state_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except OSError as error:
            print(f"[registry] failed to write {self._state_path}: {error}")
