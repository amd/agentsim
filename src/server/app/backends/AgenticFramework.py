# Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
#
# See LICENSE for license information.

"""Backend interface for an agentic framework.

A backend knows how to read one tool's session data (e.g. Claude Code) and
translate it into the shared wire types. The server holds one initialized
instance per framework and dispatches to the right one based on the request,
so adding support for another framework means adding a subclass -- nothing
else in the server changes.
"""

import os
from abc import ABC, abstractmethod
from collections.abc import Callable
from pathlib import Path

from app.models import SessionMetadata, SessionTrace

# Module-level metadata cache shared by every file-backed backend, keyed by
# absolute path -> (st_mtime_ns, st_size, SessionMetadata). A metadata request
# otherwise re-reads and re-parses *every* transcript on *every* poll; over a
# watched ~/.claude that grows as Claude Code is used, that repeated full scan is
# the performance cliff behind the "Cannot reach server." stalls. Module-level so
# the ephemeral probes in detected_frameworks/validate_source hit the same cache
# the long-lived backends populate.
_metadata_cache: dict[str, tuple[int, int, SessionMetadata]] = {}


def cached_metadata(path: str, build: Callable[[], SessionMetadata]) -> SessionMetadata:
    """Return a transcript's metadata, reparsing only when the file changed.

    ``build`` parses the file fresh and is called only on a cache miss (the file
    is new or its mtime/size moved). Returns a *copy* on every call: the server
    stamps per-request fields (source id, model_display, favorite) onto the
    metadata, so handing out the shared cached instance would leak one source's
    stamp into another's. ``is_live`` is intentionally left to the caller to
    recompute, since it depends on wall-clock recency, not file content.
    """
    try:
        st = os.stat(path)
        signature = (st.st_mtime_ns, st.st_size)
    except OSError:
        return build()  # can't stat (racing deletion, permissions) -> don't cache
    entry = _metadata_cache.get(path)
    if entry is not None and (entry[0], entry[1]) == signature:
        return entry[2].model_copy()
    meta = build()
    _metadata_cache[path] = (signature[0], signature[1], meta)
    return meta.model_copy()


class AgenticFramework(ABC):
    name: str            # human-readable name, e.g. "Claude Code"
    alias: str           # short id used on the API / CLI, e.g. "claudecode"
    data_basepath: str   # root directory the framework stores its sessions under
    default_data_basepath: str
    primary_color: str   # brand color as a CSS hex string, e.g. "#D97757"
    # Prefix stripped from model names before they leave the server, e.g.
    # "claude-" turns "claude-opus-4" into "opus-4". "" leaves names untouched.
    remove_model_nameprefix: str = ""
    # Whether a source of this framework is a folder of sibling session files
    # whose membership can be frozen into an explicit child list at import time.
    # True for file-of-sessions frameworks (Claude Code, Pi); False for
    # single-database frameworks (Hermes), which always serve their whole db.
    supports_snapshot: bool = True

    # A source's membership is a "children" set threaded into the backend:
    #   * ``"*"``       -- the framework's canonical location: serve every file in
    #                      its known layout (auto-watch). We know exactly where the
    #                      files live, so this never scans loose/unrelated files.
    #   * ``list[str]`` -- serve exactly these files (paths relative to the parent),
    #                      a frozen snapshot that ignores files added later.
    #   * ``None``      -- a probe (validate / manual-folder import): broadly scan
    #                      an arbitrary folder and keep only files that validate as
    #                      real sessions. Snapshots are frozen from this set.

    @classmethod
    def detect(cls) -> str | None:
        """Return the default data path if it exists on this machine, else None.

        Used to auto-discover installed frameworks the user hasn't added yet.
        """
        path = Path(cls.default_data_basepath)
        return str(path) if path.exists() else None

    def _discover(self) -> list[str]:
        """Absolute paths of session files in the framework's *canonical* layout.

        This is the ``"*"`` (watch) view: only the known location where the
        framework writes transcripts, so loose files sitting elsewhere under the
        home (e.g. Claude Code's ``history.jsonl``) are never swept in.
        Snapshotting backends override this with their layout glob; the base
        returns nothing so non-snapshotting frameworks (Hermes) never scan.
        """
        return []

    def _snapshot_candidates(self) -> list[str]:
        """Every *possible* session file under an arbitrary imported folder.

        Broader than :meth:`_discover`: the canonical layout PLUS files sitting
        directly in the folder, since a manually imported folder may be a copied
        home or a flat export. Each candidate is validated by the caller before
        it counts, so this may include non-session files. Falls back to the
        canonical layout for backends that don't distinguish the two.
        """
        return self._discover()

    def is_session_file(self, path: str) -> bool:
        """Whether ``path`` parses into a real session (a non-empty trace).

        Used to reject stray files (logs, command history, unrelated JSON) when
        freezing an arbitrary folder's membership, so only genuine transcripts
        are imported.
        """
        try:
            _, trace = self.parse_file(path)
        except Exception:
            return False
        return bool(trace.spans)

    def discover_relative(self) -> list[str]:
        """The importable session files as paths relative to ``data_basepath``.

        Used by the registry to freeze a manual folder's membership at import
        time. Only files that validate as real sessions are included.
        """
        return [
            os.path.relpath(path, self.data_basepath)
            for path in self._snapshot_candidates()
            if self.is_session_file(path)
        ]

    def parse_file(self, path: str) -> tuple[SessionMetadata, SessionTrace]:
        """Parse one session file into its metadata + full trace.

        Snapshotting backends implement this; the base raises so a backend that
        can't read a single file (e.g. a whole-database framework) fails loudly
        if asked to snapshot.
        """
        raise NotImplementedError

    @abstractmethod
    def init(self) -> None:
        """Resolve paths and prepare to serve requests. Called once at startup."""

    @abstractmethod
    def get_sessions_list(self) -> list[SessionMetadata]:
        """Return a descriptor for every session this backend can read."""

    @abstractmethod
    def get_session_trace(self, session_id: str) -> SessionTrace:
        """Return the full ordered span trace for one session.

        Raises ``FileNotFoundError`` when ``session_id`` is unknown.
        """
