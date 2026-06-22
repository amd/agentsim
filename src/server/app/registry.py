"""Runtime registry of framework backends (the app's data sources).

Two layers:
  * ``AVAILABLE`` -- the catalog: every framework alias the server knows how to
    build, mapped to its class. Supporting a new tool means adding its class here.
  * ``FrameworkRegistry`` -- the *active* subset: the frameworks currently
    instantiated and served. They can be added/removed at runtime and the active
    set is persisted to a JSON file so the choice survives restarts.

The registry owns the ``active`` dict that ``server.py`` reads on every request,
so mutating it (add/remove) is immediately visible to all endpoints.
"""

import json
from pathlib import Path

from app.backends.AgenticFramework import AgenticFramework
from app.backends.ClaudeCode import ClaudeCode

# The catalog: every framework type the server can build, keyed by alias.
AVAILABLE: dict[str, type[AgenticFramework]] = {cls.alias: cls for cls in (ClaudeCode,)}


class FrameworkRegistry:
    def __init__(self, state_path: Path, default_data_dir: str | None = None) -> None:
        self._state_path = state_path
        # Used only when seeding the active set on first run: each framework reads
        # ``<default_data_dir>/<alias>``. ``None`` means use each framework's own
        # default location (e.g. ClaudeCode -> ~/.claude/projects).
        self._default_data_dir = default_data_dir
        self.active: dict[str, AgenticFramework] = {}
        # Remember the path each active framework was added with (``None`` = its
        # own default) so persistence round-trips the original intent.
        self._paths: dict[str, str | None] = {}

    # --- catalog -------------------------------------------------------------
    def available(self) -> list[type[AgenticFramework]]:
        """Every framework type that can be activated, active or not."""
        return list(AVAILABLE.values())

    # --- active set ----------------------------------------------------------
    def get(self, alias: str) -> AgenticFramework | None:
        return self.active.get(alias)

    def add(self, alias: str, path: str | None = None) -> AgenticFramework:
        """Activate a framework from the catalog.

        Raises ``KeyError`` if the alias is unknown, ``ValueError`` if it is
        already active.
        """
        cls = AVAILABLE.get(alias)
        if cls is None:
            raise KeyError(alias)
        if alias in self.active:
            raise ValueError(f"framework already active: {alias}")
        framework = cls(path)
        framework.init()
        self.active[alias] = framework
        self._paths[alias] = path
        self.save()
        return framework

    def remove(self, alias: str) -> None:
        """Deactivate a framework. Raises ``KeyError`` if it is not active."""
        if alias not in self.active:
            raise KeyError(alias)
        del self.active[alias]
        self._paths.pop(alias, None)
        self.save()

    # --- persistence ---------------------------------------------------------
    def load(self) -> None:
        """Restore the active set from disk.

        On first run (no state file) every catalog framework is activated with
        its default path, preserving the out-of-the-box behavior.
        """
        entries: list[dict] | None = None
        if self._state_path.exists():
            try:
                data = json.loads(self._state_path.read_text(encoding="utf-8"))
                entries = data.get("active")
            except (OSError, json.JSONDecodeError) as error:
                print(f"[registry] failed to read {self._state_path}: {error}")

        if entries is None:
            entries = [
                {
                    "alias": alias,
                    "path": str(Path(self._default_data_dir) / alias) if self._default_data_dir else None,
                }
                for alias in AVAILABLE
            ]

        self.active.clear()
        self._paths.clear()
        for entry in entries:
            alias = entry.get("alias")
            if alias not in AVAILABLE:
                print(f"[registry] skipping unknown framework: {alias}")
                continue
            try:
                self.add(alias, entry.get("path"))
            except ValueError:
                pass  # duplicate in the state file; ignore

    def save(self) -> None:
        payload = {"active": [{"alias": a, "path": self._paths.get(a)} for a in self.active]}
        try:
            self._state_path.parent.mkdir(parents=True, exist_ok=True)
            self._state_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except OSError as error:
            print(f"[registry] failed to write {self._state_path}: {error}")
