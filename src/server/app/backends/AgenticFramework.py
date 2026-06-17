"""Backend interface for an agentic framework.

A backend knows how to read one tool's on-disk session data (e.g. Claude Code)
and translate it into the shared wire types. The Router talks only to this
interface, so adding support for another framework means adding a subclass --
nothing else in the server changes.
"""

from abc import ABC, abstractmethod

from app.models import SessionTraceData


class AgenticFramework(ABC):
    name: str            # human-readable name, e.g. "Claude Code"
    alias: str           # short id used on the CLI / in the registry, e.g. "claudecode"
    data_basepath: str   # root directory the framework stores its sessions under

    @abstractmethod
    def init(self) -> None:
        """Resolve paths and prepare to serve requests. Called once at startup."""

    @abstractmethod
    def get_sessions_list(self) -> list[str]:
        """Return the ids of every session this backend can read."""

    @abstractmethod
    def get_session_trace_data(self, session_id: str) -> SessionTraceData:
        """Return the full ordered trace for one session.

        Raises ``FileNotFoundError`` when ``session_id`` is unknown.
        """
