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
from pathlib import Path

from app.models import SessionMetadata, SessionTrace


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
    #   * ``None`` / ``"*"``  -- discover every parseable file under the parent
    #                            on each request (auto-watch, canonical location).
    #   * ``list[str]``       -- serve exactly these files (paths relative to the
    #                            parent), a frozen snapshot that ignores new files.
    # Snapshotting frameworks build the list once via ``discover_relative()``.

    @classmethod
    def detect(cls) -> str | None:
        """Return the default data path if it exists on this machine, else None.

        Used to auto-discover installed frameworks the user hasn't added yet.
        """
        path = Path(cls.default_data_basepath)
        return str(path) if path.exists() else None

    def _discover(self) -> list[str]:
        """Absolute paths of every parseable session file under ``data_basepath``.

        Snapshotting backends override this with their layout globs; the base
        returns nothing so non-snapshotting frameworks (Hermes) never snapshot.
        """
        return []

    def discover_relative(self) -> list[str]:
        """The discovered session files as paths relative to ``data_basepath``.

        Used by the registry to freeze a folder's membership at import time.
        """
        return [os.path.relpath(p, self.data_basepath) for p in self._discover()]

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
