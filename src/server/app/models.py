"""Shared data types for the server.

One small module that everything else imports. The field names here ARE the
HTTP/JSON contract: the frontend (api.ts) and the CLI expect these exact keys,
so keeping the model identical to the wire format means clients need no changes.
"""

from pydantic import BaseModel

class SessionTracesData(BaseModel):
    [SessionTraceData]

class SessionTraceData(BaseModel):
    message: str
