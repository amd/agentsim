# Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
#
# See LICENSE for license information.

"""Agentic-framework backend for Claude Code.

The data basepath is Claude Code's home (``~/.claude``); transcripts are read
from its ``projects/<project>/<id>.jsonl`` subtree and flattened into a span
trace.

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
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app import diagnostics
from app.backends.AgenticFramework import AgenticFramework, cached_metadata
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


def _parse_session_file(session_path: str) -> tuple[list[dict], int]:
    """Parse a transcript into ``(records, skipped_count)``.

    Tolerates both JSON-lines and whitespace-separated concatenated JSON by
    decoding objects one at a time off the raw text. A malformed or truncated
    record -- e.g. the unfinished trailing line of a live transcript Claude Code
    is still writing, or a single corrupt line -- is skipped rather than aborting
    the whole file: on a decode error we advance to the next line boundary and
    keep the records we could read. ``skipped_count`` reports how many records
    were dropped so callers can surface it.
    """
    decoder = json.JSONDecoder()
    with open(session_path, "r", encoding="utf-8") as handle:
        content = handle.read()

    objects: list[dict] = []
    skipped = 0
    idx, length = 0, len(content)
    while idx < length:
        while idx < length and content[idx].isspace():
            idx += 1
        if idx >= length:
            break
        try:
            obj, end = decoder.raw_decode(content, idx)
        except json.JSONDecodeError:
            skipped += 1
            nl = content.find("\n", idx)
            if nl == -1:
                break  # truncated trailing record: nothing more to recover
            idx = nl + 1
            continue
        if isinstance(obj, dict):
            objects.append(obj)
        idx = end
    return objects, skipped


def _parse_ts(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))


def _shift_timestamp(timestamp: str, seconds: float) -> str:
    return (_parse_ts(timestamp) + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")


def _offset_ms(timestamp: str, origin: datetime) -> int:
    return int((_parse_ts(timestamp) - origin).total_seconds() * 1000)


def _file_mtime_iso(path: str) -> str:
    """The file's mtime as an ISO-8601 UTC string, or "" if it can't be read.

    Used as a last-resort session timestamp: a partial transcript (all records
    skipped, or none carrying a timestamp) has no in-band time, and an empty
    timestamp breaks date display/sorting downstream."""
    try:
        return (
            datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )
    except OSError:
        return ""


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


def _message_of(record: dict) -> dict:
    """The record's ``message`` object, or ``{}`` when it's absent or malformed
    (some records carry a string/list here); keeps ``.get`` chains from raising."""
    message = record.get("message")
    return message if isinstance(message, dict) else {}


def _build_timeline(records: list[dict]) -> list[dict]:
    """Reconstruct the ordered list of timeline blocks from raw records."""
    # index tool results by tool_use_id so each tool call can find its output + end time
    tool_results: dict[str, dict] = {}
    for record in records:
        message = _message_of(record)
        content = message.get("content")
        if record.get("type") == "user" and isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_result":
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
        message = _message_of(record)
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
                if not isinstance(block, dict):
                    continue
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
            attachment = record.get("attachment")
            if not isinstance(attachment, dict):
                attachment = {}
            timeline.append({
                "start_time": timestamp,
                "end_time": timestamp,
                "type": "attachment",
                "title": attachment.get("type", "attachment"),
                "content": attachment.get("content"),
            })
            end_by_uuid[uuid] = timestamp

    return timeline


def _metadata_from_records(records: list[dict], path: str, session_id: str) -> SessionMetadata:
    """Build a session descriptor from one transcript's parsed records."""
    title = None
    first_user_message = None
    created = None
    modified = None
    project_path = ""
    model = ""
    for record in records:
        rtype = record.get("type")
        if rtype == "ai-title":
            title = record.get("aiTitle")
        elif rtype == "user":
            if created is None:
                created = record.get("timestamp")
            if first_user_message is None:
                content = _message_of(record).get("content")
                if isinstance(content, str) and content.strip():
                    first_user_message = content.strip()
        elif rtype == "assistant" and record.get("timestamp"):
            modified = record.get("timestamp")
        # cwd/model can appear on several record types; take the first cwd
        # and the latest model seen.
        if not project_path and record.get("cwd"):
            project_path = record.get("cwd")
        record_model = _message_of(record).get("model")
        if record_model:
            model = record_model

    # A partial session (e.g. a just-started live transcript that only holds
    # header records like "mode"/"permission-mode", or one with a user turn but
    # no assistant reply yet) has no conversation timestamp. Fall back to the
    # earliest/latest timestamp on *any* record, then to the file mtime, so the
    # date is never empty (an empty date breaks display/sorting downstream).
    record_times = sorted(r.get("timestamp") for r in records if r.get("timestamp"))
    fallback = record_times[0] if record_times else _file_mtime_iso(path)

    return SessionMetadata(
        session_id=session_id,
        title=title or first_user_message or session_id,
        data_path=path,
        is_live=_is_live(path),
        project_path=project_path,
        project_slug=os.path.basename(os.path.dirname(path)),
        model=model,
        effort_level="",  # not present in Claude Code transcripts
        timestamp_created=created or fallback,
        timestamp_modified=modified or (record_times[-1] if record_times else fallback),
    )


def _trace_from_records(records: list[dict], session_id: str) -> SessionTrace:
    """Flatten one transcript's parsed records into an ordered span trace."""
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


class ClaudeCode(AgenticFramework):
    name = "Claude Code"
    alias = "claudecode"
    default_data_basepath = Path.home() / ".claude"
    primary_color = "#D97757"  # Anthropic coral
    remove_model_nameprefix = "claude-"

    def __init__(self, data_dir: Path | str | None = None,
                 children: str | list[str] | None = None) -> None:
        self._data_dir = Path(data_dir) if data_dir is not None else None
        self._children = children
        self.data_basepath = ""


    def init(self) -> None:
        base = self._data_dir if self._data_dir is not None else self.default_data_basepath
        self.data_basepath = str(base)

    # Transcripts live under "<data_basepath>/projects/<project>/<id>.jsonl";
    # data_basepath is the framework home (e.g. ~/.claude), not the projects dir.
    def _projects_dir(self) -> str:
        return os.path.join(self.data_basepath, "projects")

    @staticmethod
    def _id_of(path: str) -> str:
        return os.path.basename(path).split(".")[0]

    def _discover(self) -> list[str]:
        # Canonical layout only: transcripts live under projects/<project>/<id>.jsonl.
        # Loose *.jsonl in the home (history.jsonl, etc.) are not sessions, so the
        # "*" (watch) view must not sweep them in.
        return sorted(glob.glob(os.path.join(self._projects_dir(), "*", "*.jsonl")))

    def _snapshot_candidates(self) -> list[str]:
        # An arbitrary imported folder may hold transcripts nested (a copied
        # ~/.claude) or sitting directly inside (an exported "sessions" folder);
        # scan both. is_session_file() then filters out non-session files.
        nested = glob.glob(os.path.join(self._projects_dir(), "*", "*.jsonl"))
        direct = glob.glob(os.path.join(self.data_basepath, "*.jsonl"))
        return sorted(set(nested) | set(direct))

    def _session_paths(self) -> list[str]:
        if isinstance(self._children, list):
            return [
                p for c in self._children
                if os.path.exists(p := os.path.join(self.data_basepath, c))
            ]
        if self._children == "*":
            return self._discover()  # canonical location, trusted layout
        # children is None: a validate/manual probe -- scan broadly but keep only
        # files that parse as real sessions.
        return [p for p in self._snapshot_candidates() if self.is_session_file(p)]

    def _session_path(self, session_id: str) -> str:
        for path in self._session_paths():
            if self._id_of(path) == session_id:
                return path
        raise FileNotFoundError(f"unknown session: {session_id}")

    def get_sessions_list(self) -> list[SessionMetadata]:
        if os.path.isfile(self.data_basepath):
            try:
                meta, trace = self.parse_file(self.data_basepath)
            except Exception as error:  # a bad single-file source yields nothing
                print(f"[claudecode] failed to read {self.data_basepath}: {error}")
                diagnostics.record(
                    "error", self.data_basepath, str(error),
                    framework=self.alias, path=self.data_basepath,
                )
                return []
            return [meta] if trace.spans else []

        sessions: list[SessionMetadata] = []
        for path in self._session_paths():
            session_id = os.path.basename(path).split(".")[0]
            try:
                def build() -> SessionMetadata:
                    records, skipped = _parse_session_file(path)
                    self._note_parse(path, skipped)
                    return _metadata_from_records(records, path, session_id)
                meta = cached_metadata(path, build)
                meta.is_live = _is_live(path)  # recency, not content: never cached
                sessions.append(meta)
            except Exception as error:  # one unreadable file never drops the rest
                print(f"[claudecode] failed to read {path}: {error}")
                diagnostics.record(
                    "error", path, str(error), framework=self.alias, path=path,
                )
                continue
        return sessions

    def get_session_trace(self, session_id: str) -> SessionTrace:
        if os.path.isfile(self.data_basepath):
            meta, trace = self.parse_file(self.data_basepath)
            if session_id != meta.session_id:
                raise FileNotFoundError(f"unknown session: {session_id}")
            return trace

        path = self._session_path(session_id)  # raises FileNotFoundError if absent
        records, skipped = _parse_session_file(path)
        self._note_parse(path, skipped)
        return _trace_from_records(records, session_id)

    def parse_file(self, path: str) -> tuple[SessionMetadata, SessionTrace]:
        records, skipped = _parse_session_file(path)
        self._note_parse(path, skipped)
        session_id = os.path.basename(path).split(".")[0]
        meta = _metadata_from_records(records, path, session_id)
        meta.is_live = False  # an imported file is a static reference, never "live"
        trace = _trace_from_records(records, session_id)
        return meta, trace

    def _note_parse(self, path: str, skipped: int) -> None:
        """Surface (or clear) a per-file parse warning after a resilient read."""
        if skipped:
            print(f"[claudecode] {path}: skipped {skipped} unreadable record(s)")
            diagnostics.record(
                "warning", path,
                f"skipped {skipped} unreadable record(s)",
                framework=self.alias, path=path, count=skipped,
            )
        else:
            diagnostics.resolve(path)
