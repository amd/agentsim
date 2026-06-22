"""Backend interface for an agentic framework.

A backend knows how to read one tool's session data (e.g. Claude Code) and
translate it into the shared wire types. The server holds one initialized
instance per framework and dispatches to the right one based on the request,
so adding support for another framework means adding a subclass -- nothing
else in the server changes.
"""

from abc import ABC, abstractmethod
from pathlib import Path

from app.models import SessionMetadata, SessionTrace


class AgenticFramework(ABC):
    name: str            # human-readable name, e.g. "Claude Code"
    alias: str           # short id used on the API / CLI, e.g. "claudecode"
    data_basepath: str   # root directory the framework stores its sessions under
    default_data_basepath: str

    @classmethod
    def detect(cls) -> str | None:
        """Return the default data path if it exists on this machine, else None.

        Used to auto-discover installed frameworks the user hasn't added yet.
        """
        path = Path(cls.default_data_basepath)
        return str(path) if path.exists() else None

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
