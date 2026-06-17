"""Agentic-framework backend for Claude Code.

Currently returns mock sessions and traces so the API and frontend can be
developed against a stable shape. The real implementation will read Claude
Code's JSON-lines transcripts from ``~/.claude/projects`` and flatten each
into the same span trace these mocks produce.
"""

from pathlib import Path

from app.backends.AgenticFramework import AgenticFramework
from app.models import SessionInfo, SessionTraceData, Span, SpanType

_MOCK_TRACES: dict[str, list[Span]] = {
    "sess-aaaa-1111": [
        Span(type=SpanType.user_message, content="List the files in this repo", timestamp="2026-06-17T10:00:00Z"),
        Span(type=SpanType.agent_thinking, content="The user wants a directory listing. I'll run ls.", timestamp="2026-06-17T10:00:01Z"),
        Span(type=SpanType.agent_message, content="I'll list the files.", timestamp="2026-06-17T10:00:02Z"),
        Span(type=SpanType.agent_tooluse, content='{"command": "ls -la"}', timestamp="2026-06-17T10:00:03Z", name="Bash"),
        Span(type=SpanType.agent_message, content="There are 3 files: app/, main.py, requirements.txt.", timestamp="2026-06-17T10:00:05Z"),
    ],
    "sess-bbbb-2222": [
        Span(type=SpanType.user_message, content="Fix the failing test in test_models.py", timestamp="2026-06-17T11:30:00Z"),
        Span(type=SpanType.agent_thinking, content="I should read the test first to see what it expects.", timestamp="2026-06-17T11:30:01Z"),
        Span(type=SpanType.agent_tooluse, content='{"file_path": "test_models.py"}', timestamp="2026-06-17T11:30:02Z", name="Read"),
        Span(type=SpanType.agent_message, content="The assertion expected `spans`, not `messages`. Patching it.", timestamp="2026-06-17T11:30:06Z"),
        Span(type=SpanType.agent_tooluse, content='{"file_path": "test_models.py", "old": "messages", "new": "spans"}', timestamp="2026-06-17T11:30:07Z", name="Edit"),
    ],
}


class ClaudeCode(AgenticFramework):
    name = "Claude Code"
    alias = "claudecode"

    def __init__(self, data_dir: Path | str | None = None) -> None:
        self._data_dir = Path(data_dir) if data_dir is not None else None
        self.data_basepath = ""

    def init(self) -> None:
        base = self._data_dir if self._data_dir is not None else Path.home() / ".claude" / "projects"
        self.data_basepath = str(base)

    def get_sessions_list(self) -> list[SessionInfo]:
        return [
            SessionInfo(
                id="sess-aaaa-1111",
                name="Explore repo layout",
                data_path=str(Path(self.data_basepath) / "sess-aaaa-1111.jsonl"),
            ),
            SessionInfo(
                id="sess-bbbb-2222",
                name="Fix failing model test",
                data_path=str(Path(self.data_basepath) / "sess-bbbb-2222.jsonl"),
            ),
        ]

    def get_session_trace_data(self, session_id: str) -> SessionTraceData:
        spans = _MOCK_TRACES.get(session_id)
        if spans is None:
            raise FileNotFoundError(f"unknown session: {session_id}")
        return SessionTraceData(session_id=session_id, spans=list(spans))
