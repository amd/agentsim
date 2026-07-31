# Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
#
# See LICENSE for license information.

"""Agentic-framework backend for Pi.

The data basepath is Pi's home (``~/.pi/agent/sessions``); transcripts are
read from its ``<encoded-cwd>/<timestamp>_<uuid>.jsonl`` subtree and flattened
into a span trace.

Timing is reconstructed the same way as ClaudeCode: a block *ends* at its own
record timestamp and *starts* where the nearest preceding block ended. Preceding
blocks are found by walking the ``parentId`` chain. Each span carries both
wall-clock timestamps and integer ``offset_*`` values in milliseconds relative
to the session's first block. For ``agent_tool`` spans the tool name is carried
in ``title``.
"""

import glob
import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

from app.backends.AgenticFramework import AgenticFramework
from app.models import SessionMetadata, SessionTrace, Span, SpanType

LIVE_WINDOW_S = 120

# When an assistant turn's thinking and reply share one record timestamp, their
# window is split by content length. This base is added to every length so a very
# short reply still gets a visible, clickable slice instead of a zero-width sliver.
_SUBSPAN_BASE_WEIGHT = 100

_THINKING_LEVEL_TO_EFFORT: dict[str, str] = {
    "off": "",
    "medium": "medium",
    "high": "high",
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


def _metadata_from_records(records: list[dict], path: str, session_id: str) -> SessionMetadata:
    """Build a session descriptor from one transcript's parsed records."""
    first_user_message = None
    created = None
    modified = None
    project_path = ""
    model = ""
    effort_level = ""

    for record in records:
        rtype = record.get("type")
        timestamp = record.get("timestamp")

        if rtype == "session":
            if not project_path and record.get("cwd"):
                project_path = record.get("cwd")

        elif rtype == "model_change":
            if record.get("modelId") and not model:
                model = record.get("modelId")

        elif rtype == "thinking_level_change":
            level = record.get("thinkingLevel", "")
            effort_level = _THINKING_LEVEL_TO_EFFORT.get(level, level)

        elif rtype == "message":
            message = record.get("message") or {}
            role = message.get("role")

            if role == "user":
                if created is None:
                    created = timestamp
                if first_user_message is None:
                    content = message.get("content")
                    if isinstance(content, list) and content:
                        block = content[0]
                        if block.get("type") == "text":
                            text = block.get("text", "").strip()
                            if text:
                                first_user_message = text

            elif role == "assistant":
                if timestamp:
                    modified = timestamp
                record_model = message.get("model")
                if record_model:
                    model = record_model

    return SessionMetadata(
        session_id=session_id,
        title=first_user_message or session_id,
        data_path=path,
        is_live=_is_live(path),
        project_path=project_path,
        project_slug=os.path.basename(os.path.dirname(path)),
        model=model,
        effort_level=effort_level,
        timestamp_created=created or "",
        timestamp_modified=modified or "",
    )


def _trace_from_records(records: list[dict], session_id: str) -> SessionTrace:
    """Flatten one transcript's parsed records into an ordered span trace."""
    # Pass 1: index all toolResult messages by toolCallId
    tool_results: dict[str, dict] = {}
    for record in records:
        if record.get("type") != "message":
            continue
        message = record.get("message") or {}
        if message.get("role") == "toolResult":
            call_id = message.get("toolCallId")
            if call_id:
                tool_results[call_id] = {
                    "timestamp": record.get("timestamp"),
                    "content": message.get("content"),
                    "is_error": message.get("isError", False),
                }

    # Pass 2: build parentId chain and end-time index
    parent_of = {r.get("id"): r.get("parentId") for r in records if r.get("id")}
    end_by_id: dict[str, str] = {}

    def start_for(parent_id: str | None, end_time: str) -> str:
        seen: set[str] = set()
        current = parent_id
        while current and current not in seen:
            if current in end_by_id:
                return end_by_id[current]
            seen.add(current)
            current = parent_of.get(current)
        return _shift_timestamp(end_time, -10)

    # Pass 3: emit spans
    spans: list[dict] = []
    for record in records:
        rtype = record.get("type")
        timestamp = record.get("timestamp")
        record_id = record.get("id")
        parent = record.get("parentId")

        if rtype == "compaction":
            # A compaction is instantaneous. Emit it as a marker but do NOT
            # anchor the parent chain on it: leaving it out of end_by_id lets
            # the following user message stretch back past it to the previous
            # real block's end, so idle "user think time" before the
            # compaction is attributed to the user message instead of showing
            # as dead air. Mirrors ClaudeCode, where summary records never
            # anchor the chain.
            spans.append({
                "start_time": timestamp,
                "end_time": timestamp,
                "type": SpanType.other,
                "title": "Context Compaction",
                "content": record.get("summary", ""),
            })
            continue

        if rtype != "message":
            continue

        message = record.get("message") or {}
        role = message.get("role")

        if role == "user":
            content = message.get("content")
            text = ""
            if isinstance(content, list) and content:
                block = content[0]
                if block.get("type") == "text":
                    text = block.get("text", "")
            spans.append({
                "start_time": start_for(parent, timestamp),
                "end_time": timestamp,
                "type": SpanType.user_message,
                "title": "User",
                "content": text,
            })
            if record_id:
                end_by_id[record_id] = timestamp

        elif role == "toolResult":
            if record_id:
                end_by_id[record_id] = timestamp

        elif role == "assistant":
            content = message.get("content")
            if not content:
                # empty content with stopReason="error"
                spans.append({
                    "start_time": start_for(parent, timestamp),
                    "end_time": timestamp,
                    "type": SpanType.other,
                    "title": "Error",
                    "content": message.get("errorMessage", ""),
                })
                if record_id:
                    end_by_id[record_id] = timestamp
                continue

            # Thinking and text blocks share the message's single record
            # timestamp, but thinking precedes the reply. With no real
            # sub-timing, lay them sequentially across [start, timestamp]
            # weighted by content length (plus a base so a short reply still
            # gets a clickable slice) instead of stacking them on one
            # overlapping window. Tool calls keep their own [timestamp,
            # result] window. Mirrors the split in Hermes.py.
            start = start_for(parent, timestamp)
            pre: list[tuple[SpanType, str, str]] = []
            tool_blocks: list[dict] = []
            for block in content:
                btype = block.get("type")
                if btype == "thinking":
                    pre.append((SpanType.agent_thinking, "Thinking", block.get("thinking", "")))
                elif btype == "text":
                    pre.append((SpanType.agent_message, "Assistant", block.get("text", "")))
                elif btype == "toolCall":
                    tool_blocks.append(block)

            last_end = None
            span_seconds = (_parse_ts(timestamp) - _parse_ts(start)).total_seconds()
            weights = [_SUBSPAN_BASE_WEIGHT + len(_content_to_str(c)) for _, _, c in pre]
            total = sum(weights) or 1
            sub_start_dt = _parse_ts(start)
            sub_start_iso = start
            for i, ((stype, title, blk_content), weight) in enumerate(zip(pre, weights)):
                # Last sub-span ends exactly at the record timestamp (no drift).
                if i == len(pre) - 1:
                    sub_end_iso = timestamp
                else:
                    sub_end_dt = sub_start_dt + timedelta(seconds=span_seconds * (weight / total))
                    sub_end_iso = sub_end_dt.isoformat().replace("+00:00", "Z")
                    sub_start_dt = sub_end_dt
                spans.append({
                    "start_time": sub_start_iso,
                    "end_time": sub_end_iso,
                    "type": stype,
                    "title": title,
                    "content": blk_content,
                })
                last_end = sub_end_iso
                sub_start_iso = sub_end_iso

            for block in tool_blocks:
                result = tool_results.get(block.get("id"), {})
                blk_end = result.get("timestamp") or timestamp
                spans.append({
                    "start_time": timestamp,
                    "end_time": blk_end,
                    "type": SpanType.agent_tool,
                    "title": block.get("name", ""),
                    "content": {
                        "input": block.get("arguments"),
                        "result": result.get("content"),
                        "is_error": result.get("is_error", False),
                    },
                })
                last_end = blk_end

            if last_end is not None and record_id:
                end_by_id[record_id] = last_end

    # convert raw dicts to Span objects
    start_times = [b["start_time"] for b in spans if b.get("start_time")]
    origin = _parse_ts(min(start_times)) if start_times else None

    span_objects: list[Span] = []
    for index, block in enumerate(spans):
        span_type = block["type"] if isinstance(block["type"], SpanType) else SpanType.other

        ts_start = block.get("start_time") or ""
        ts_end = block.get("end_time") or ""
        offset_start = _offset_ms(ts_start, origin) if (origin and ts_start) else 0
        offset_end = _offset_ms(ts_end, origin) if (origin and ts_end) else offset_start

        span_objects.append(Span(
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

    return SessionTrace(session_id=session_id, spans=span_objects)


class Pi(AgenticFramework):
    name = "Pi"
    alias = "pi"
    default_data_basepath = Path.home() / ".pi" / "agent" / "sessions"
    primary_color = "#9CA3AF"


    remove_model_nameprefix = ""

    def __init__(self, data_dir: Path | str | None = None,
                 children: str | list[str] | None = None) -> None:
        self._data_dir = Path(data_dir) if data_dir is not None else None
        self._children = children
        self.data_basepath = ""

    def init(self) -> None:
        base = self._data_dir if self._data_dir is not None else self.default_data_basepath
        self.data_basepath = str(base)

    @staticmethod
    def _id_of(path: str) -> str:
        # Pi transcripts are "<timestamp>_<uuid>.jsonl"; the session id is the
        # uuid part, or the whole stem for arbitrary imported files.
        stem = os.path.basename(path).replace(".jsonl", "")
        return stem.split("_", 1)[1] if "_" in stem else stem

    def _discover(self) -> list[str]:
        # One-subfolder-per-session layout, plus transcripts sitting directly in
        # the folder (an exported/copied sessions folder).
        nested = glob.glob(os.path.join(self.data_basepath, "*", "*.jsonl"))
        direct = glob.glob(os.path.join(self.data_basepath, "*.jsonl"))
        return sorted(set(nested) | set(direct))

    def _session_paths(self) -> list[str]:
        if isinstance(self._children, list):
            return [
                p for c in self._children
                if os.path.exists(p := os.path.join(self.data_basepath, c))
            ]
        return self._discover()

    def _session_path(self, session_id: str) -> str:
        for path in self._session_paths():
            if self._id_of(path) == session_id:
                return path
        raise FileNotFoundError(f"unknown session: {session_id}")

    def get_sessions_list(self) -> list[SessionMetadata]:
        if os.path.isfile(self.data_basepath):
            meta, trace = self.parse_file(self.data_basepath)
            return [meta] if trace.spans else []

        sessions: list[SessionMetadata] = []
        for path in self._session_paths():
            basename = os.path.basename(path)
            try:
                session_id = basename.split("_", 1)[1].replace(".jsonl", "")
            except IndexError:
                continue
            try:
                records = _parse_session_file(path)
            except (json.JSONDecodeError, OSError) as error:
                print(f"[pi] failed to parse {path}: {error}")
                continue
            sessions.append(_metadata_from_records(records, path, session_id))
        return sessions

    def get_session_trace(self, session_id: str) -> SessionTrace:
        if os.path.isfile(self.data_basepath):
            meta, trace = self.parse_file(self.data_basepath)
            if session_id != meta.session_id:
                raise FileNotFoundError(f"unknown session: {session_id}")
            return trace

        records = _parse_session_file(self._session_path(session_id))
        return _trace_from_records(records, session_id)

    def parse_file(self, path: str) -> tuple[SessionMetadata, SessionTrace]:
        records = _parse_session_file(path)
        basename = os.path.basename(path)
        # Pi transcripts are "<timestamp>_<uuid>.jsonl"; fall back to the full
        # stem for arbitrary imported files that don't follow that convention.
        stem = basename.replace(".jsonl", "")
        session_id = stem.split("_", 1)[1] if "_" in stem else stem
        meta = _metadata_from_records(records, path, session_id)
        meta.is_live = False  # an imported file is a static reference, never "live"
        trace = _trace_from_records(records, session_id)
        return meta, trace
