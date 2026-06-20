"""Pydantic schemas for the saved-sessions API."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class GraphPayload(BaseModel):
    """The canvas graph snapshot. ``view`` is optional so older clients
    that only send ``{nodes, connections}`` keep working."""
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    connections: list[dict[str, Any]] = Field(default_factory=list)
    view: dict[str, Any] | None = None


class SessionUpsert(BaseModel):
    """POST/PUT body for save & save-as. Upsert keyed on (owner, lower(name))."""
    name: str = Field(..., min_length=1, max_length=120)
    graph: GraphPayload


class SessionSummary(BaseModel):
    """Lightweight list-view representation (no graph payload)."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    display_name: str
    node_count: int
    edge_count: int
    owner_user_id: int | None
    # Echoed back to the client so the UI can render an "owned by me"
    # vs. "shared with me" pill without extra round-trips.
    is_owner: bool = False
    shared_with_me: bool = False
    created_at: datetime
    updated_at: datetime


class SessionDetail(SessionSummary):
    """Full payload — includes the graph JSON parsed back into a dict."""
    graph: GraphPayload


# ── Sharing ──────────────────────────────────────────────────────────


class ShareIn(BaseModel):
    """Share by email — the server resolves to the recipient's user id."""
    email: EmailStr


class ShareOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    session_id: str
    user_id:    int
    # Joined on read from the auth DB so the UI can render the chip
    # without a second request.
    email:        EmailStr | None = None
    display_name: str | None = None
    created_at:   datetime
