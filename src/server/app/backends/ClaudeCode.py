"""Agentic-framework backend for Claude Code.

Currently returns mock sessions and traces so the API and frontend can be
developed against a stable shape. The real implementation will read Claude
Code's JSON-lines transcripts from ``~/.claude/projects`` and flatten each
into the same span trace these mocks produce.

Span timing is expressed two ways: wall-clock ISO timestamps
(``timestamp_start`` / ``timestamp_end``) and integer ``offset_*`` values in
milliseconds from the session's init time, which is what the timeline lays out
against.
"""

from pathlib import Path

from app.backends.AgenticFramework import AgenticFramework
from app.models import SessionInfo, SessionTrace, Span, SpanType

_MOCK_TRACES: dict[str, list[Span]] = {
    "sess-aaaa-1111": [
        Span(type=SpanType.user_message, content="List the files in this repo",
             timestamp_start="2026-06-17T10:00:00.000Z", timestamp_end="2026-06-17T10:00:00.000Z",
             offset_start_ms=0, offset_end=0, duration_ms=0),
        Span(type=SpanType.agent_thinking, content="The user wants a directory listing. I'll run ls.",
             timestamp_start="2026-06-17T10:00:01.000Z", timestamp_end="2026-06-17T10:00:01.800Z",
             offset_start_ms=1000, offset_end=1800, duration_ms=800),
        Span(type=SpanType.agent_message, content="I'll list the files.",
             timestamp_start="2026-06-17T10:00:01.800Z", timestamp_end="2026-06-17T10:00:02.200Z",
             offset_start_ms=1800, offset_end=2200, duration_ms=400),
        Span(type=SpanType.agent_tool, content='{"command": "ls -la"}', name="Bash",
             timestamp_start="2026-06-17T10:00:02.200Z", timestamp_end="2026-06-17T10:00:04.500Z",
             offset_start_ms=2200, offset_end=4500, duration_ms=2300),
        Span(type=SpanType.agent_message, content="There are 3 files: app/, main.py, requirements.txt.",
             timestamp_start="2026-06-17T10:00:04.500Z", timestamp_end="2026-06-17T10:00:05.200Z",
             offset_start_ms=4500, offset_end=5200, duration_ms=700),
    ],
    "sess-bbbb-2222": [
        Span(type=SpanType.user_message, content="Fix the failing test in test_models.py",
             timestamp_start="2026-06-17T11:30:00.000Z", timestamp_end="2026-06-17T11:30:00.000Z",
             offset_start_ms=0, offset_end=0, duration_ms=0),
        Span(type=SpanType.agent_thinking, content="I should read the test first to see what it expects.",
             timestamp_start="2026-06-17T11:30:01.000Z", timestamp_end="2026-06-17T11:30:01.500Z",
             offset_start_ms=1000, offset_end=1500, duration_ms=500),
        Span(type=SpanType.agent_tool, content='{"file_path": "test_models.py"}', name="Read",
             timestamp_start="2026-06-17T11:30:01.500Z", timestamp_end="2026-06-17T11:30:06.000Z",
             offset_start_ms=1500, offset_end=6000, duration_ms=4500),
        Span(type=SpanType.agent_message, content="The assertion expected `spans`, not `messages`. Patching it.",
             timestamp_start="2026-06-17T11:30:06.000Z", timestamp_end="2026-06-17T11:30:06.800Z",
             offset_start_ms=6000, offset_end=6800, duration_ms=800),
        Span(type=SpanType.agent_tool, content='{"file_path": "test_models.py", "old": "messages", "new": "spans"}', name="Edit",
             timestamp_start="2026-06-17T11:30:06.800Z", timestamp_end="2026-06-17T11:30:09.000Z",
             offset_start_ms=6800, offset_end=9000, duration_ms=2200),
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

    def get_session_trace(self, session_id: str) -> SessionTrace:
        spans = _MOCK_TRACES.get(session_id)
        if spans is None:
            raise FileNotFoundError(f"unknown session: {session_id}")
        return SessionTrace(session_id=session_id, spans=list(spans))
