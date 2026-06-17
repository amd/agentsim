"""Shared data types for the server.

One small module that everything else imports. The field names here ARE the
HTTP/JSON contract: the frontend (api.ts) and the CLI expect these exact keys,
so keeping the model identical to the wire format means clients need no changes.
"""

from pydantic import BaseModel


class Message(BaseModel):
    """A single entry in a session trace, exactly as it appears on the wire.

    One transcript event: a chat message or a tool interaction. The timeline
    renders one of these per row, grouping/collapsing by ``type``.
    """

    role: str           # "user" | "assistant" | "system"
    type: str           # "message" | "tool_use" | "tool_result"
    content: str        # human-readable text for this entry
    timestamp: str      # ISO-8601 timestamp; "" when the source omits one
    name: str = ""      # tool name for tool_use / tool_result, else ""


class SessionTraceData(BaseModel):
    """The full trace for one session: its id plus every message in order."""

    session_id: str
    messages: list[Message]


class SessionTracesData(BaseModel):
    """A collection of session traces (used when returning more than one)."""

    sessions: list[SessionTraceData]
