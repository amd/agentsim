"""Agentic-framework backend for Codex.

Scaffold only: identity and paths are wired up, but the session parsing logic
is not implemented yet, so the data methods return nothing.
"""

from pathlib import Path

from app.backends.AgenticFramework import AgenticFramework
from app.models import SessionMetadata, SessionTrace


class Codex(AgenticFramework):
    name = "Codex"
    alias = "codex"
    default_data_basepath = str(Path.home() / ".codex" / "sessions")
    primary_color = "#10A37F"  # OpenAI green

    def __init__(self, data_dir: Path | str | None = None) -> None:
        self._data_dir = Path(data_dir) if data_dir is not None else None
        self.data_basepath = ""

    def init(self) -> None:
        base = self._data_dir if self._data_dir is not None else self.default_data_basepath
        self.data_basepath = str(base)

    def get_sessions_list(self) -> list[SessionMetadata]:
        return []  # TODO: parse Codex sessions

    def get_session_trace(self, session_id: str) -> SessionTrace:
        raise FileNotFoundError(f"unknown session: {session_id}")
