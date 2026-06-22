"""Agentic-framework backend for Cursor.

The data basepath is Cursor's home (``~/.cursor``); transcripts are read from its
``projects/<project>/agent-transcripts/<session-id>/<session-id>.jsonl`` subtree.

Cursor's transcripts are far sparser than Claude Code's: each record is just
``{"role": ..., "message": {"content": [...]}}`` with text and ``tool_use``
blocks. There are no timestamps, no model name, no title, and no cwd. So timing
is synthesized (each span chained at a fixed step), the title is taken from the
first user query, the project path is recovered best-effort from the folder
slug, and created/modified times come from the file's mtime/ctime.
"""

import glob
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.backends.AgenticFramework import AgenticFramework
from app.models import SessionMetadata, SessionTrace, Span, SpanType

# A session whose transcript file was modified within this many seconds is
# treated as "live". As with Claude Code, file recency is the only signal.
LIVE_WINDOW_S = 120

# Cursor records carry no timing, so each span is given this fixed duration and
# chained one after another to produce a readable (if synthetic) timeline.
STEP_MS = 1000


def _parse_session_file(session_path: str) -> list[dict]:
    """Parse a JSON-lines transcript into a list of records."""
    records: list[dict] = []
    with open(session_path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def _is_live(session_path: str) -> bool:
    try:
        return (time.time() - os.path.getmtime(session_path)) <= LIVE_WINDOW_S
    except OSError:
        return False


def _file_time(session_path: str, getter) -> str:
    """ISO-8601 (UTC) timestamp from a filesystem time getter, or "" on error."""
    try:
        return datetime.fromtimestamp(getter(session_path), tz=timezone.utc).isoformat()
    except OSError:
        return ""


def _content_to_str(content: object) -> str:
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    return json.dumps(content, ensure_ascii=False, default=str)


def _first_text(content: object) -> str:
    """The first text block's text from a message content list, else ""."""
    if isinstance(content, list):
        for block in content:
            if block.get("type") == "text":
                return block.get("text") or ""
    return ""


def _clean_title(text: str) -> str:
    """Strip Cursor's ``<user_query>`` wrapper and collapse to a one-line title."""
    text = text.replace("<user_query>", "").replace("</user_query>", "")
    line = " ".join(text.split())
    return line[:80]


def _deslug(slug: str) -> str:
    """Recover a display path from a Cursor project folder name.

    Cursor slugifies the project's absolute path, replacing the drive colon and
    path separators with "-". The original can't be recovered exactly (dashes in
    real folder names are indistinguishable from separators), so this is a
    best-effort: a leading single-letter segment becomes the drive, the rest are
    joined with "/".
    """
    parts = slug.split("-")
    if parts and len(parts[0]) == 1 and parts[0].isalpha():
        return parts[0].upper() + ":/" + "/".join(parts[1:])
    return slug


class Cursor(AgenticFramework):
    name = "Cursor"
    alias = "cursor"
    default_data_basepath = Path.home() / ".cursor"
    primary_color = "#4F8FF7"  # Cursor blue

    def __init__(self, data_dir: Path | str | None = None) -> None:
        self._data_dir = Path(data_dir) if data_dir is not None else None
        self.data_basepath = ""

    def init(self) -> None:
        base = self._data_dir if self._data_dir is not None else self.default_data_basepath
        self.data_basepath = str(base)

    # Transcripts live under
    # "<data_basepath>/projects/<project>/agent-transcripts/<id>/<id>.jsonl".
    def _projects_dir(self) -> str:
        return os.path.join(self.data_basepath, "projects")

    def _session_paths(self) -> list[str]:
        return glob.glob(os.path.join(self._projects_dir(), "*", "agent-transcripts", "*", "*.jsonl"))

    def _session_path(self, session_id: str) -> str:
        matches = glob.glob(
            os.path.join(self._projects_dir(), "*", "agent-transcripts", session_id, f"{session_id}.jsonl")
        )
        if not matches:
            raise FileNotFoundError(f"unknown session: {session_id}")
        return matches[0]

    def _project_slug(self, path: str) -> str:
        """The "<project>" folder name from a transcript path."""
        # .../projects/<project>/agent-transcripts/<id>/<id>.jsonl
        agent_dir = os.path.dirname(os.path.dirname(os.path.dirname(path)))
        return os.path.basename(agent_dir)

    def get_sessions_list(self) -> list[SessionMetadata]:
        sessions: list[SessionMetadata] = []
        for path in self._session_paths():
            session_id = os.path.basename(path).split(".")[0]
            try:
                records = _parse_session_file(path)
            except json.JSONDecodeError as error:
                print(f"[cursor] failed to parse {path}: {error}")
                continue

            title = ""
            for record in records:
                if record.get("role") == "user":
                    title = _clean_title(_first_text((record.get("message") or {}).get("content")))
                    if title:
                        break

            slug = self._project_slug(path)
            sessions.append(SessionMetadata(
                session_id=session_id,
                title=title or session_id,
                data_path=path,
                is_live=_is_live(path),
                project_path=_deslug(slug),
                project_slug=slug,
                model="",            # not present in Cursor transcripts
                effort_level="",     # not present in Cursor transcripts
                timestamp_created=_file_time(path, os.path.getctime),
                timestamp_modified=_file_time(path, os.path.getmtime),
            ))
        return sessions

    def get_session_trace(self, session_id: str) -> SessionTrace:
        path = self._session_path(session_id)
        records = _parse_session_file(path)
        origin = _file_time(path, os.path.getctime)
        origin_dt = datetime.fromisoformat(origin) if origin else datetime.now(tz=timezone.utc)

        spans: list[Span] = []

        def add(span_type: SpanType, title: str, content: object) -> None:
            index = len(spans)
            offset_start = index * STEP_MS
            offset_end = offset_start + STEP_MS
            ts_start = (origin_dt + timedelta(milliseconds=offset_start)).isoformat()
            ts_end = (origin_dt + timedelta(milliseconds=offset_end)).isoformat()
            spans.append(Span(
                span_id=f"{session_id}-{index}",
                type=span_type,
                title=title,
                content=_content_to_str(content),
                timestamp_start=ts_start,
                timestamp_end=ts_end,
                offset_start_ms=offset_start,
                offset_end=offset_end,
                duration_ms=STEP_MS,
            ))

        for record in records:
            role = record.get("role")
            content = (record.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                btype = block.get("type")
                if btype == "text":
                    text = block.get("text") or ""
                    if not text.strip():
                        continue
                    if role == "user":
                        add(SpanType.user_message, "User", text)
                    else:
                        add(SpanType.agent_message, "Assistant", text)
                elif btype == "tool_use":
                    add(SpanType.agent_tool, block.get("name") or "tool", block.get("input"))

        return SessionTrace(session_id=session_id, spans=spans)
