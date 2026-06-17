"""Shared data types for the server.

One small module that everything else imports. The field names here ARE the
HTTP/JSON contract: the frontend (api.ts) and the CLI expect these exact keys,
so keeping the model identical to the wire format means clients need no changes.
"""

from enum import Enum

from pydantic import BaseModel


class SpanType(str, Enum):
    """The kinds of events a trace is made of."""

    user_message = "user_message"
    agent_message = "agent_message"
    agent_thinking = "agent_thinking"
    agent_tooluse = "agent_tooluse"


class Span(BaseModel):
    """The fundamental component of a trace: a single timeline event.

    Every row the timeline draws is one Span. ``content`` is the human-readable
    text; ``name`` carries the tool name when ``type`` is ``agent_tooluse``.
    """

    type: SpanType
    content: str
    timestamp_start: str = ""   # ISO-8601; "" when the source omits one
    timestamp_end: str = ""   # ISO-8601; "" when the source omits one
    timetick_start: int # milliseconds from the session init time to span start
    timetick_end: int  # milliseconds from the session init time to span end
    duration_ms: int = 0 # how amny ms it took for the span
    name: str = ""        # tool name for agent_tooluse, else ""


class SessionInfo(BaseModel):
    """Lightweight descriptor of one session, returned by the session list."""

    id: str
    name: str
    data_path: str


class SessionTrace(BaseModel):
    """The full trace for one session: its id plus every span in order."""

    session_id: str
    spans: list[Span]

