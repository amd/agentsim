"""Agentic-framework backend for Claude Code.

Claude Code records each conversation as a JSON-lines transcript at
``~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl``. Every line is one
event (a user/assistant message or a tool interaction). This backend walks
those files and flattens each transcript into the shared ``SessionTraceData``
the timeline renders.

The data root is overridable (``--data-dir``) so the server can read an
exported/sample tree instead of the live ``~/.claude`` directory.
"""

import json
from pathlib import Path

from app.backends.AgenticFramework import AgenticFramework
from app.models import Message, SessionTraceData


def _stringify(value: object) -> str:
    """Render an arbitrary JSON value as readable single-string content."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            else:
                parts.append(_stringify(item))
        return "\n".join(p for p in parts if p)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, indent=2)
    return "" if value is None else str(value)


def _blocks_to_messages(role: str, content: object, timestamp: str) -> list[Message]:
    """Turn one transcript line's ``message.content`` into timeline entries."""
    if isinstance(content, str):
        return [Message(role=role, type="message", content=content, timestamp=timestamp)]

    if not isinstance(content, list):
        return []

    messages: list[Message] = []
    for block in content:
        if not isinstance(block, dict):
            messages.append(Message(role=role, type="message", content=_stringify(block), timestamp=timestamp))
            continue

        btype = block.get("type")
        if btype == "text":
            messages.append(Message(role=role, type="message", content=str(block.get("text", "")), timestamp=timestamp))
        elif btype == "thinking":
            messages.append(Message(role=role, type="message", content=str(block.get("thinking", "")), timestamp=timestamp))
        elif btype == "tool_use":
            messages.append(Message(
                role=role,
                type="tool_use",
                content=_stringify(block.get("input")),
                timestamp=timestamp,
                name=str(block.get("name", "")),
            ))
        elif btype == "tool_result":
            messages.append(Message(
                role="tool",
                type="tool_result",
                content=_stringify(block.get("content")),
                timestamp=timestamp,
            ))
    return messages


class ClaudeCode(AgenticFramework):
    name = "Claude Code"
    alias = "claudecode"

    def __init__(self, data_dir: Path | str | None = None) -> None:
        self._data_dir = Path(data_dir) if data_dir is not None else None
        self.data_basepath = ""

    def init(self) -> None:
        base = self._data_dir if self._data_dir is not None else Path.home() / ".claude" / "projects"
        self.data_basepath = str(base)

    def _base(self) -> Path:
        return Path(self.data_basepath)

    def get_sessions_list(self) -> list[str]:
        base = self._base()
        if not base.exists():
            return []
        return sorted({path.stem for path in base.rglob("*.jsonl")})

    def get_session_trace_data(self, session_id: str) -> SessionTraceData:
        path = self._find_session_file(session_id)
        if path is None:
            raise FileNotFoundError(f"unknown session: {session_id}")

        messages: list[Message] = []
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if event.get("type") not in ("user", "assistant"):
                    continue
                payload = event.get("message") or {}
                role = payload.get("role", event.get("type", ""))
                messages.extend(
                    _blocks_to_messages(role, payload.get("content"), event.get("timestamp", ""))
                )

        return SessionTraceData(session_id=session_id, messages=messages)

    def _find_session_file(self, session_id: str) -> Path | None:
        base = self._base()
        if not base.exists():
            return None
        candidate = base / f"{session_id}.jsonl"
        if candidate.exists():
            return candidate
        return next(iter(base.rglob(f"{session_id}.jsonl")), None)
