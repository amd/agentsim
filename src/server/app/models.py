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
    agent_tool = "agent_tool"
    other = "other"


class Span(BaseModel):
    """The fundamental component of a trace: a single timeline event.

    Every row the timeline draws is one Span. ``content`` is the human-readable
    text; ``name`` carries the tool name when ``type`` is ``agent_tool``.
    """

    span_id: str
    type: SpanType

    title: str = ""             # displayed span title
    content: str = ""           # span content

    timestamp_start: str = ""   # ISO-8601; "" when the source omits one
    timestamp_end: str = ""     # ISO-8601; "" when the source omits one
    offset_start_ms: int = 0    # milliseconds from the session init time to span start
    offset_end: int = 0         # milliseconds from the session init time to span end
    duration_ms: int = 0        # span duration


class SessionMetadata(BaseModel):
    """Lightweight descriptor of one session, returned by the session list."""

    session_id: str
    title: str
    data_path: str
    is_live: bool

    project_path: str
    project_slug: str

    framework: str = ""  # alias of the backend this session came from
    model: str
    effort_level: str

    timestamp_created: str
    timestamp_modified: str


class SessionTrace(BaseModel):
    """The full trace for one session: its id plus every span in order."""

    session_id: str
    spans: list[Span]


class FrameworkInfo(BaseModel):
    """A framework (data source) the server knows about.

    One shape serves every framework view: the active set, the catalog of
    available types, auto-detected sources, and the filter facets. Fields that
    don't apply to a given view are left at their defaults -- e.g. ``data_basepath``
    is the resolved path for active/detected frameworks and ``""`` in the catalog;
    ``session_count`` is populated where a count is meaningful and ``0`` otherwise.
    """

    alias: str
    name: str
    primary_color: str = ""
    data_basepath: str = ""
    session_count: int = 0


class ProjectFacet(BaseModel):
    """One project option for the filter window, with its session count."""

    path: str
    name: str
    count: int


class SessionFacets(BaseModel):
    """Distinct filter options across all sessions, built by the backend so the
    frontend's filter window mirrors what's actually available."""

    frameworks: list[FrameworkInfo]
    projects: list[ProjectFacet]


class AddFrameworkRequest(BaseModel):
    """Body for activating a framework. ``path`` overrides the framework's
    default data location; ``None`` uses its default."""

    alias: str
    path: str | None = None

