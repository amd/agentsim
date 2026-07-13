"""Agentic-framework backend for Hermes (Nous Research).

Unlike the JSONL backends, Hermes keeps everything in a single SQLite database at
its per-OS home (``state.db``):

  * Windows        ``%LOCALAPPDATA%\\hermes\\state.db``
  * macOS / Linux  ``~/.hermes/state.db``
  * ``$HERMES_HOME`` overrides the home dir on any platform.

Two tables carry the data: ``sessions`` (one row per session -- model, cwd, git
info, timestamps, title) and ``messages`` (one row per turn -- role, content,
``tool_calls`` JSON, reasoning, and a real unix-epoch ``timestamp``), joined by
``messages.session_id``.

Because Hermes records a real timestamp on every message there is no timing to
synthesize (contrast ``Cursor.py``): a span *ends* at its own record timestamp
and *starts* where the previous span ended -- the same model ``ClaudeCode.py``
uses, only here the timestamps are read straight from the DB instead of walking a
parent chain. Tool results live in their own ``role='tool'`` rows and are folded
back into the ``tool_call`` span they belong to via ``tool_call_id``.

The DB is read from a throwaway copy of the ``state.db`` (+ ``-wal`` / ``-shm``)
trio so a live Hermes holding the WAL lock is never disturbed and uncommitted WAL
data is still seen (opening ``immutable=1`` would miss it).
"""

import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from app.backends.AgenticFramework import AgenticFramework
from app.models import SessionMetadata, SessionTrace, Span, SpanType

# A session whose DB file was touched within this many seconds is considered
# recent; combined with an open (``ended_at IS NULL``) session it counts as live.
LIVE_WINDOW_S = 120

# When an assistant turn's thinking and reply share one timestamp, their window is
# split by content length. This base is added to every length so a very short reply
# still gets a visible, clickable slice instead of a zero-width sliver.
_SUBSPAN_BASE_WEIGHT = 100


def _default_hermes_home() -> str:
    """The default Hermes home dir for this OS (``$HERMES_HOME`` wins)."""
    env = os.environ.get("HERMES_HOME")
    if env:
        return env
    if sys.platform.startswith("win"):
        local = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return os.path.join(local, "hermes")
    return str(Path.home() / ".hermes")


def _iso(epoch: float | None) -> str:
    """A REAL unix-epoch timestamp as an ISO-8601 UTC string, or "" if absent."""
    if epoch is None:
        return ""
    try:
        return datetime.fromtimestamp(float(epoch), tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except (OSError, ValueError, OverflowError):
        return ""


def _content_to_str(content: object) -> str:
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    return json.dumps(content, ensure_ascii=False, default=str)


def _parse_tool_calls(raw: object) -> list[dict]:
    """Decode the ``messages.tool_calls`` JSON column into a list of calls.

    Each returned dict is ``{"id", "name", "input"}`` where ``input`` is the
    decoded arguments (dict) when possible, else the raw string.
    """
    if not raw:
        return []
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(data, list):
        return []

    calls: list[dict] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        function = entry.get("function") or {}
        name = function.get("name") or entry.get("name") or "tool"
        args = function.get("arguments", entry.get("arguments"))
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                pass  # keep the raw argument string
        calls.append({
            "id": entry.get("id") or entry.get("call_id") or entry.get("tool_call_id"),
            "name": name,
            "input": args,
        })
    return calls


class Hermes(AgenticFramework):
    name = "Hermes"
    alias = "hermes"
    default_data_basepath = _default_hermes_home()
    primary_color = "#8A63D2"  # Nous purple

    def __init__(self, data_dir: Path | str | None = None) -> None:
        self._data_dir = Path(data_dir) if data_dir is not None else None
        self.data_basepath = ""

    @classmethod
    def detect(cls) -> str | None:
        """Only advertise Hermes when a real ``state.db`` is present."""
        home = Path(cls.default_data_basepath)
        return str(home) if (home / "state.db").exists() else None

    def init(self) -> None:
        base = self._data_dir if self._data_dir is not None else self.default_data_basepath
        self.data_basepath = str(base)

    # ``data_basepath`` is the Hermes home; the DB is ``<home>/state.db``. A
    # custom path pointing straight at a ``.db`` file is honored as-is.
    def _db_path(self) -> str:
        if self.data_basepath.endswith(".db"):
            return self.data_basepath
        return os.path.join(self.data_basepath, "state.db")

    @contextmanager
    def _open_db(self) -> Iterator[sqlite3.Connection | None]:
        """Yield a read connection to a private snapshot of the live DB.

        Copies the ``state.db`` (+ WAL sidecars) into a temp dir and opens that,
        so a running Hermes is never touched and committed-but-uncheckpointed WAL
        rows are still visible. Yields ``None`` when no DB exists.
        """
        db_path = self._db_path()
        if not os.path.exists(db_path):
            yield None
            return

        tmpdir = tempfile.mkdtemp(prefix="agentsim_hermes_")
        try:
            for suffix in ("", "-wal", "-shm"):
                src = db_path + suffix
                if os.path.exists(src):
                    shutil.copy2(src, os.path.join(tmpdir, "state.db" + suffix))
            conn = sqlite3.connect(os.path.join(tmpdir, "state.db"))
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def _is_live(self, ended_at: object) -> bool:
        """Live = the session has no end time and the DB was touched recently."""
        if ended_at is not None:
            return False
        try:
            return (time.time() - os.path.getmtime(self._db_path())) <= LIVE_WINDOW_S
        except OSError:
            return False

    def get_sessions_list(self) -> list[SessionMetadata]:
        sessions: list[SessionMetadata] = []
        db_path = self._db_path()
        with self._open_db() as conn:
            if conn is None:
                return []
            rows = conn.execute(
                """
                SELECT id, model, cwd, title, started_at, ended_at
                FROM sessions
                ORDER BY started_at DESC
                """
            ).fetchall()

            for row in rows:
                session_id = row["id"]
                title = row["title"]
                if not title:
                    first = conn.execute(
                        """
                        SELECT content FROM messages
                        WHERE session_id = ? AND role = 'user'
                              AND content IS NOT NULL AND TRIM(content) != ''
                        ORDER BY id LIMIT 1
                        """,
                        (session_id,),
                    ).fetchone()
                    if first and first["content"]:
                        title = first["content"].strip().splitlines()[0][:80]

                modified = row["ended_at"]
                if modified is None:
                    last = conn.execute(
                        "SELECT MAX(timestamp) AS t FROM messages WHERE session_id = ?",
                        (session_id,),
                    ).fetchone()
                    modified = last["t"] if last else None

                cwd = row["cwd"] or ""
                sessions.append(SessionMetadata(
                    session_id=session_id,
                    title=title or session_id,
                    data_path=db_path,
                    is_live=self._is_live(row["ended_at"]),
                    project_path=cwd,
                    project_slug=os.path.basename(cwd.rstrip("/\\")) if cwd else "",
                    model=row["model"] or "",
                    effort_level="",  # no per-session effort level in Hermes
                    timestamp_created=_iso(row["started_at"]),
                    timestamp_modified=_iso(modified),
                ))
        return sessions

    def get_session_trace(self, session_id: str) -> SessionTrace:
        with self._open_db() as conn:
            if conn is None:
                raise FileNotFoundError(f"unknown session: {session_id}")
            exists = conn.execute(
                "SELECT 1 FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if exists is None:
                raise FileNotFoundError(f"unknown session: {session_id}")

            rows = conn.execute(
                """
                SELECT id, role, content, tool_call_id, tool_calls, tool_name,
                       timestamp, reasoning, reasoning_content
                FROM messages
                WHERE session_id = ?
                ORDER BY id
                """,
                (session_id,),
            ).fetchall()

        # Index tool results by the id of the call they answer, so each tool_call
        # span can absorb its output and end at the result's timestamp.
        tool_results: dict[str, dict] = {}
        for row in rows:
            if row["role"] == "tool" and row["tool_call_id"]:
                tool_results[row["tool_call_id"]] = {
                    "content": row["content"],
                    "timestamp": row["timestamp"],
                }

        # Build intermediate blocks with float-epoch start/end, chaining each span
        # to the end of the previous one.
        blocks: list[dict] = []
        prev_end: float | None = None

        def emit(span_type: SpanType, title: str, content: object, start: float, end: float) -> None:
            blocks.append({"type": span_type, "title": title, "content": content,
                           "start": start, "end": end})

        for row in rows:
            role = row["role"]
            ts = row["timestamp"]
            # No prior span (the first message): give it a 10s lead so it renders
            # as a clickable span instead of a zero-width sliver.
            start = prev_end if prev_end is not None else (ts - 10.0)

            if role == "user":
                emit(SpanType.user_message, "User", row["content"] or "", start, ts)
                prev_end = ts

            elif role == "assistant":
                # Reasoning and message share one DB timestamp (same row), but
                # thinking precedes the reply. With no real sub-timing, lay them
                # sequentially across [start, ts] weighted by content length (plus
                # a base so a short reply still gets a clickable slice).
                reasoning = row["reasoning_content"] or row["reasoning"]
                pre: list[tuple[SpanType, str, object]] = []
                if reasoning and reasoning.strip():
                    pre.append((SpanType.agent_thinking, "Thinking", reasoning))
                if row["content"] and row["content"].strip():
                    pre.append((SpanType.agent_message, "Assistant", row["content"]))
                weights = [_SUBSPAN_BASE_WEIGHT + len(_content_to_str(c)) for _, _, c in pre]
                total = sum(weights) or 1
                sub_start = start
                for i, ((stype, title, content), weight) in enumerate(zip(pre, weights)):
                    # Last sub-span ends exactly at ts (avoids float drift).
                    sub_end = ts if i == len(pre) - 1 else sub_start + (ts - start) * (weight / total)
                    emit(stype, title, content, sub_start, sub_end)
                    sub_start = sub_end
                for call in _parse_tool_calls(row["tool_calls"]):
                    result = tool_results.get(call["id"], {})
                    end = result.get("timestamp", ts)
                    emit(SpanType.agent_tool, call["name"],
                         {"input": call["input"], "result": result.get("content")},
                         ts, end)
                prev_end = ts

            elif role == "tool":
                # Folded into its tool_call span above; only advance the chain.
                prev_end = ts

            else:
                if row["content"] and row["content"].strip():
                    emit(SpanType.other, role or "message", row["content"], start, ts)
                prev_end = ts

        starts = [b["start"] for b in blocks if b["start"] is not None]
        origin = min(starts) if starts else 0.0

        spans: list[Span] = []
        for index, block in enumerate(blocks):
            start = block["start"] if block["start"] is not None else origin
            end = block["end"] if block["end"] is not None else start
            offset_start = int((start - origin) * 1000)
            offset_end = int((end - origin) * 1000)
            spans.append(Span(
                span_id=f"{session_id}-{index}",
                type=block["type"],
                title=block["title"] or "",
                content=_content_to_str(block["content"]),
                timestamp_start=_iso(start),
                timestamp_end=_iso(end),
                offset_start_ms=offset_start,
                offset_end=offset_end,
                duration_ms=max(0, offset_end - offset_start),
            ))

        return SessionTrace(session_id=session_id, spans=spans)
