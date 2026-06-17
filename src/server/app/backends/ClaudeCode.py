"""Agentic-framework backend for Claude Code.

Currently returns mock sessions and traces so the API and frontend can be
developed against a stable shape. The real implementation will read Claude
Code's JSON-lines transcripts from ``~/.claude/projects`` and flatten each
into the same span trace these mocks produce.

Span timing is expressed two ways: wall-clock ISO timestamps
(``timestamp_start`` / ``timestamp_end``) and integer ``offset_*`` values in
milliseconds from the session's init time, which is what the timeline lays out
against. For ``agent_tool`` spans the tool name is carried in ``title``.
"""

from pathlib import Path

from app.backends.AgenticFramework import AgenticFramework
from app.models import SessionMetadata, SessionTrace, Span, SpanType

_MOCK_TRACES: dict[str, list[Span]] = {
    "sess-aaaa-1111": [
        Span(span_id="sess-aaaa-1111-0", type=SpanType.user_message,
             content="List the files in this repo",
             timestamp_start="2026-06-17T10:00:00.000Z", timestamp_end="2026-06-17T10:00:00.000Z",
             offset_start_ms=0, offset_end=0, duration_ms=0),
        Span(span_id="sess-aaaa-1111-1", type=SpanType.agent_thinking,
             content="The user wants a directory listing. I'll run ls.",
             timestamp_start="2026-06-17T10:00:01.000Z", timestamp_end="2026-06-17T10:00:01.800Z",
             offset_start_ms=1000, offset_end=1800, duration_ms=800),
        Span(span_id="sess-aaaa-1111-2", type=SpanType.agent_message,
             content="I'll list the files.",
             timestamp_start="2026-06-17T10:00:01.800Z", timestamp_end="2026-06-17T10:00:02.200Z",
             offset_start_ms=1800, offset_end=2200, duration_ms=400),
        Span(span_id="sess-aaaa-1111-3", type=SpanType.agent_tool, title="Bash",
             content='{"command": "ls -la"}',
             timestamp_start="2026-06-17T10:00:02.200Z", timestamp_end="2026-06-17T10:00:04.500Z",
             offset_start_ms=2200, offset_end=4500, duration_ms=2300),
        Span(span_id="sess-aaaa-1111-4", type=SpanType.agent_message,
             content="There are 3 files: app/, main.py, requirements.txt.",
             timestamp_start="2026-06-17T10:00:04.500Z", timestamp_end="2026-06-17T10:00:05.200Z",
             offset_start_ms=4500, offset_end=5200, duration_ms=700),
    ],
    "sess-bbbb-2222": [
        Span(span_id="sess-bbbb-2222-0", type=SpanType.user_message,
             content="Fix the failing test in test_models.py",
             timestamp_start="2026-06-17T11:30:00.000Z", timestamp_end="2026-06-17T11:30:00.000Z",
             offset_start_ms=0, offset_end=0, duration_ms=0),
        Span(span_id="sess-bbbb-2222-1", type=SpanType.agent_thinking,
             content="I should read the test first to see what it expects.",
             timestamp_start="2026-06-17T11:30:01.000Z", timestamp_end="2026-06-17T11:30:01.500Z",
             offset_start_ms=1000, offset_end=1500, duration_ms=500),
        Span(span_id="sess-bbbb-2222-2", type=SpanType.agent_tool, title="Read",
             content='{"file_path": "test_models.py"}',
             timestamp_start="2026-06-17T11:30:01.500Z", timestamp_end="2026-06-17T11:30:06.000Z",
             offset_start_ms=1500, offset_end=6000, duration_ms=4500),
        Span(span_id="sess-bbbb-2222-3", type=SpanType.agent_message,
             content="The assertion expected `spans`, not `messages`. Patching it.",
             timestamp_start="2026-06-17T11:30:06.000Z", timestamp_end="2026-06-17T11:30:06.800Z",
             offset_start_ms=6000, offset_end=6800, duration_ms=800),
        Span(span_id="sess-bbbb-2222-4", type=SpanType.agent_tool, title="Edit",
             content='{"file_path": "test_models.py", "old": "messages", "new": "spans"}',
             timestamp_start="2026-06-17T11:30:06.800Z", timestamp_end="2026-06-17T11:30:09.000Z",
             offset_start_ms=6800, offset_end=9000, duration_ms=2200),
    ],
}

_MOCK_SESSIONS: dict[str, dict[str, str]] = {
    "sess-aaaa-1111": {
        "title": "Explore repo layout",
        "timestamp_created": "2026-06-17T10:00:00.000Z",
        "timestamp_modified": "2026-06-17T10:00:05.200Z",
    },
    "sess-bbbb-2222": {
        "title": "Fix failing model test",
        "timestamp_created": "2026-06-17T11:30:00.000Z",
        "timestamp_modified": "2026-06-17T11:30:09.000Z",
    },
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

    def get_sessions_list(self) -> list[SessionMetadata]:
        return [
            SessionMetadata(
                session_id=session_id,
                title=meta["title"],
                data_path=str(Path(self.data_basepath) / f"{session_id}.jsonl"),
                timestamp_created=meta["timestamp_created"],
                timestamp_modified=meta["timestamp_modified"],
            )
            for session_id, meta in _MOCK_SESSIONS.items()
        ]

    def get_session_trace(self, session_id: str) -> SessionTrace:
        spans = _MOCK_TRACES.get(session_id)
        if spans is None:
            raise FileNotFoundError(f"unknown session: {session_id}")
        return SessionTrace(session_id=session_id, spans=list(spans))
