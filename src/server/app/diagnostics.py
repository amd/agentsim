# Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
#
# See LICENSE for license information.

"""Process-wide collector for data-source failures surfaced to the UI.

Backends parse transcripts off the request thread(s); when a file is skipped,
partially recovered, or a whole source can't be read, the detail used to vanish
into a ``print`` on the host log. This collector keeps the most recent issues in
memory so the client can show a persistent, specific notification ("which file,
what went wrong") instead of a bare "Cannot reach server."

Entries coalesce by ``key`` (path or source id) so a file that keeps failing on
every poll updates one row rather than growing the list without bound. Access is
guarded by a lock because FastAPI runs sync handlers on a thread pool.
"""

import threading
import time as _time
from dataclasses import dataclass, field

# Cap the retained set so a pathological data dir (thousands of bad files) can't
# grow memory unbounded; oldest entries are dropped first.
_MAX_ENTRIES = 200


@dataclass
class Diagnostic:
    level: str  # "warning" (recovered with loss) | "error" (unreadable)
    key: str  # coalescing key: absolute file path or source id
    message: str
    framework: str = ""
    source_id: str = ""
    path: str = ""
    count: int = 0  # e.g. number of records skipped
    timestamp: float = field(default_factory=_time.time)


_lock = threading.Lock()
_entries: "dict[str, Diagnostic]" = {}


def record(
    level: str,
    key: str,
    message: str,
    *,
    framework: str = "",
    source_id: str = "",
    path: str = "",
    count: int = 0,
) -> None:
    """Record (or update) one issue, coalesced by ``key``."""
    with _lock:
        _entries[key] = Diagnostic(
            level=level,
            key=key,
            message=message,
            framework=framework,
            source_id=source_id,
            path=path,
            count=count,
        )
        if len(_entries) > _MAX_ENTRIES:
            # Drop the oldest by timestamp.
            oldest = min(_entries.values(), key=lambda d: d.timestamp)
            _entries.pop(oldest.key, None)


def resolve(key: str) -> None:
    """Clear a single issue once its underlying cause is gone (e.g. a file now
    parses cleanly), so a transient problem doesn't linger in the UI."""
    with _lock:
        _entries.pop(key, None)


def snapshot() -> list[dict]:
    """Current issues, newest first, as plain dicts for the JSON response."""
    with _lock:
        items = sorted(_entries.values(), key=lambda d: d.timestamp, reverse=True)
    return [
        {
            "level": d.level,
            "key": d.key,
            "message": d.message,
            "framework": d.framework,
            "source_id": d.source_id,
            "path": d.path,
            "count": d.count,
            "timestamp": d.timestamp,
        }
        for d in items
    ]


def clear() -> None:
    """Drop every recorded issue (user dismissed the notification)."""
    with _lock:
        _entries.clear()
