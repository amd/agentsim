# Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
#
# See LICENSE for license information.

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

    source_id: str = ""  # id of the source this session is routed through
    framework: str = ""  # alias of the framework format (for the chip + filter facet)
    model: str  # canonical model id as recorded by the framework (e.g. "claude-opus-4-8")
    model_display: str = ""  # human-facing label (prefix-stripped); falls back to model
    effort_level: str

    timestamp_created: str
    timestamp_modified: str


class SessionTrace(BaseModel):
    """The full trace for one session: its id plus every span in order."""

    session_id: str
    spans: list[Span]


class DataSource(BaseModel):
    """A data source the server knows about, at any life stage.

    One shape serves every view: the catalog of available framework types, the
    auto-detected candidates, the active set, and the filter facets. Fields that
    don't apply to a given view stay at their defaults -- ``path`` is the resolved
    file/folder for detected/active sources and ``""`` in the plain catalog;
    ``session_count`` is populated where a count is meaningful and ``0`` otherwise;
    ``id`` is the ``/sources/{id}/...`` routing key, set only for active sources.
    """

    alias: str  # framework format id (brand tag/color + filter facet)
    name: str
    primary_color: str = ""
    path: str = ""
    session_count: int = 0
    id: str = ""


class ProjectFacet(BaseModel):
    """One project option for the filter window, with its session count."""

    path: str
    name: str
    count: int


class ModelFacet(BaseModel):
    """One model option for the filter window, with its session count."""

    name: str
    count: int


class SessionFacets(BaseModel):
    """Distinct filter options across all sessions, built by the backend so the
    frontend's filter window mirrors what's actually available."""

    frameworks: list[DataSource]
    projects: list[ProjectFacet]
    models: list[ModelFacet]


class AddSourceRequest(BaseModel):
    """Body for adding/validating a source. ``path`` is a folder or a single
    trace file; ``None`` uses the framework's default data location."""

    framework: str
    path: str | None = None

