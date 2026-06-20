"""Pydantic schemas for the assets API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AssetKind = Literal["image", "video", "text", "caption"]


class AssetCreate(BaseModel):
    kind: AssetKind
    # Binary kinds → /media/... URL; text kinds → raw text. Capped to
    # avoid pathological payloads landing in the DB.
    value: str = Field(..., min_length=1, max_length=200_000)
    label: str | None = Field(default=None, max_length=160)
    mime: str | None = Field(default=None, max_length=80)
    bytes: int | None = Field(default=None, ge=0)
    source_node_id: str | None = Field(default=None, max_length=64)
    source_session_id: str | None = Field(default=None, max_length=64)


class AssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: AssetKind
    label: str | None
    value: str
    mime: str | None
    bytes: int | None
    source_node_id: str | None
    source_session_id: str | None
    created_at: datetime


class AssetUpdate(BaseModel):
    """Only the label is user-editable post-creation; the underlying
    media bytes are immutable so links to past graphs stay valid."""
    label: str | None = Field(default=None, max_length=160)
