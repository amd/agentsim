"""Agentic-framework backend for Claude Code.

Reads Claude Code's transcripts under ``~/.claude/projects/<project>/<id>.jsonl``
and flattens each into a span trace.

Timing is reconstructed the way the timeline needs it: a block *ends* at its own
record timestamp and *starts* where the nearest preceding block ended. Preceding
blocks are found by walking the ``parentUuid`` chain (skipping untracked records
such as system/meta lines) rather than trusting file order, so parallel tool
calls -- which share a dispatch timestamp -- overlap instead of chaining. Each
span carries both wall-clock timestamps and integer ``offset_*`` values in
milliseconds relative to the session's first block. For ``agent_tool`` spans the
tool name is carried in ``title``.
"""

import glob
import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

from app.backends.AgenticFramework import AgenticFramework
from app.models import SessionMetadata, SessionTrace, Span, SpanType

# A session whose transcript file was modified within this many seconds is
# treated as "live" (still being appended to). The transcript has no explicit
# live marker, so recency of the file is the only available signal.
LIVE_WINDOW_S = 120

# Map the intermediate timeline block types to the wire SpanType. Any block type
# not listed here (e.g. "attachment") falls back to SpanType.other.
_BLOCK_TYPE_TO_SPAN: dict[str, SpanType] = {
    "user_message": SpanType.user_message,
    "assistant_message": SpanType.agent_message,
    "thinking": SpanType.agent_thinking,
    "tool_call": SpanType.agent_tool,
}


def _parse_session_file(session_path: str) -> list[dict]:
    """Parse a transcript into a list of records.

    Tolerates both JSON-lines and whitespace-separated concatenated JSON by
    decoding objects one at a time off the raw text.
    """
    decoder = json.JSONDecoder()
    with open(session_path, "r", encoding="utf-8") as handle:
        content = handle.read()

    objects: list[dict] = []
    idx, length = 0, len(content)
    while idx < length:
        while idx < length and content[idx].isspace():
            idx += 1
        if idx >= length:
            break
        obj, end = decoder.raw_decode(content, idx)
        objects.append(obj)
        idx = end
    return objects


def _parse_ts(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))


def _shift_timestamp(timestamp: str, seconds: float) -> str:
    return (_parse_ts(timestamp) + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")


def _offset_ms(timestamp: str, origin: datetime) -> int:
    return int((_parse_ts(timestamp) - origin).total_seconds() * 1000)


def _is_live(session_path: str) -> bool:
    """A session is live if its transcript was touched within LIVE_WINDOW_S."""
    try:
        return (time.time() - os.path.getmtime(session_path)) <= LIVE_WINDOW_S
    except OSError:
        return False


def _content_to_str(content: object) -> str:
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    return json.dumps(content, ensure_ascii=False, default=str)


def _build_timeline(records: list[dict]) -> list[dict]:
    """Reconstruct the ordered list of timeline blocks from raw records."""
    # index tool results by tool_use_id so each tool call can find its output + end time
    tool_results: dict[str, dict] = {}
    for record in records:
        message = record.get("message") or {}
        content = message.get("content")
        if record.get("type") == "user" and isinstance(content, list):
            for block in content:
                if block.get("type") == "tool_result":
                    tool_results[block.get("tool_use_id")] = {
                        "timestamp": record.get("timestamp"),
                        "content": block.get("content"),
                        "is_error": block.get("is_error", False),
                    }

    # map every record to its parent so we can walk past untracked nodes
    parent_of = {r.get("uuid"): r.get("parentUuid") for r in records if r.get("uuid")}
    end_by_uuid: dict[str, str] = {}

    def start_for(parent_uuid: str | None, end_time: str) -> str:
        seen: set[str] = set()
        current = parent_uuid
        while current and current not in seen:
            if current in end_by_uuid:
                return end_by_uuid[current]
            seen.add(current)
            current = parent_of.get(current)
        return _shift_timestamp(end_time, -10)  # no prior block: show as 10 seconds

    timeline: list[dict] = []
    for record in records:
        rtype = record.get("type")
        timestamp = record.get("timestamp")
        uuid = record.get("uuid")
        parent = record.get("parentUuid")
        message = record.get("message") or {}
        content = message.get("content")

        if rtype == "user" and isinstance(content, str):
            timeline.append({
                "start_time": start_for(parent, timestamp),
                "end_time": timestamp,
                "type": "user_message",
                "title": "User",
                "content": content,
            })
            end_by_uuid[uuid] = timestamp

        elif rtype == "user" and isinstance(content, list):
            # tool_result: folded into its tool_call, but keep the chain alive
            end_by_uuid[uuid] = timestamp

        elif rtype == "assistant" and isinstance(content, list):
            last_end = None
            for block in content:
                btype = block.get("type")
                if btype == "thinking":
                    blk = {"start_time": start_for(parent, timestamp), "end_time": timestamp,
                           "type": "thinking", "title": "Thinking", "content": block.get("thinking")}
                elif btype == "text":
                    blk = {"start_time": start_for(parent, timestamp), "end_time": timestamp,
                           "type": "assistant_message", "title": "Assistant", "content": block.get("text")}
                elif btype == "tool_use":
                    result = tool_results.get(block.get("id"), {})
                    end = result.get("timestamp", timestamp)
                    blk = {"start_time": timestamp, "end_time": end,
                           "type": "tool_call", "title": block.get("name"),
                           "content": {"input": block.get("input"), "result": result.get("content"),
                                       "is_error": result.get("is_error", False)}}
                else:
                    continue
                timeline.append(blk)
                last_end = blk["end_time"]
            if last_end is not None:
                end_by_uuid[uuid] = last_end

        elif rtype == "attachment" and timestamp:
            attachment = record.get("attachment") or {}
            timeline.append({
                "start_time": timestamp,
                "end_time": timestamp,
                "type": "attachment",
                "title": attachment.get("type", "attachment"),
                "content": attachment.get("content"),
            })
            end_by_uuid[uuid] = timestamp

    return timeline


class ClaudeCode(AgenticFramework):
    name = "Claude Code"
    alias = "claudecode"

    def __init__(self, data_dir: Path | str | None = None) -> None:
        self._data_dir = Path(data_dir) if data_dir is not None else None
        self.data_basepath = ""

    def init(self) -> None:
        base = self._data_dir if self._data_dir is not None else Path.home() / ".claude" / "projects"
        self.data_basepath = str(base)

    def _session_paths(self) -> list[str]:
        return glob.glob(os.path.join(self.data_basepath, "*", "*.jsonl"))

    def _session_path(self, session_id: str) -> str:
        matches = glob.glob(os.path.join(self.data_basepath, "*", f"{session_id}.jsonl"))
        if not matches:
            matches = glob.glob(os.path.join(self.data_basepath, f"{session_id}.jsonl"))
        if not matches:
            raise FileNotFoundError(f"unknown session: {session_id}")
        return matches[0]

    def get_sessions_list(self) -> list[SessionMetadata]:
        sessions: list[SessionMetadata] = []
        for path in self._session_paths():
            session_id = os.path.basename(path).split(".")[0]
            try:
                records = _parse_session_file(path)
            except json.JSONDecodeError as error:
                print(f"[claudecode] failed to parse {path}: {error}")
                continue

            title = None
            created = None
            modified = None
            project_path = ""
            model = ""
            for record in records:
                rtype = record.get("type")
                if rtype == "ai-title":
                    title = record.get("aiTitle")
                elif rtype == "user" and created is None:
                    created = record.get("timestamp")
                elif rtype == "assistant" and record.get("timestamp"):
                    modified = record.get("timestamp")
                # cwd/model can appear on several record types; take the first cwd
                # and the latest model seen.
                if not project_path and record.get("cwd"):
                    project_path = record.get("cwd")
                record_model = (record.get("message") or {}).get("model")
                if record_model:
                    model = record_model

            sessions.append(SessionMetadata(
                session_id=session_id,
                title=title or session_id,
                data_path=path,
                is_live=_is_live(path),
                project_path=project_path,
                project_slug=os.path.basename(os.path.dirname(path)),
                model=model,
                effort_level="",  # not present in Claude Code transcripts
                timestamp_created=created or "",
                timestamp_modified=modified or "",
            ))
        return sessions

    def get_session_trace(self, session_id: str) -> SessionTrace:
        records = _parse_session_file(self._session_path(session_id))
        timeline = _build_timeline(records)

        starts = [block["start_time"] for block in timeline if block.get("start_time")]
        origin = _parse_ts(min(starts)) if starts else None

        spans: list[Span] = []
        for index, block in enumerate(timeline):
            span_type = _BLOCK_TYPE_TO_SPAN.get(block["type"], SpanType.other)

            ts_start = block.get("start_time") or ""
            ts_end = block.get("end_time") or ""
            offset_start = _offset_ms(ts_start, origin) if (origin and ts_start) else 0
            offset_end = _offset_ms(ts_end, origin) if (origin and ts_end) else offset_start

            spans.append(Span(
                span_id=f"{session_id}-{index}",
                type=span_type,
                title=block.get("title") or "",
                content=_content_to_str(block.get("content")),
                timestamp_start=ts_start,
                timestamp_end=ts_end,
                offset_start_ms=offset_start,
                offset_end=offset_end,
                duration_ms=max(0, offset_end - offset_start),
            ))

        return SessionTrace(session_id=session_id, spans=spans)
