"""Pydantic schemas for the notes API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

NodeKind = Literal["image", "video", "text", "caption"]


class NoteCreate(BaseModel):
    text:          str        = Field(..., min_length=1, max_length=4_000)
    node_id:       str | None = Field(default=None, max_length=64)
    node_title:    str | None = Field(default=None, max_length=160)
    node_kind:     NodeKind | None = None
    # Truncated server-side; the schema cap is just a sanity bound.
    preview_value: str | None = Field(default=None, max_length=8_000)
    asset_id:      str | None = Field(default=None, max_length=32)
    session_label: str | None = Field(default=None, max_length=160)


class NoteUpdate(BaseModel):
    text:          str | None = Field(default=None, min_length=1, max_length=4_000)
    session_label: str | None = Field(default=None, max_length=160)


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:            str
    text:          str
    node_id:       str | None
    node_title:    str | None
    node_kind:     str | None
    preview_value: str | None
    asset_id:      str | None
    session_label: str | None
    created_at:    datetime
    updated_at:    datetime
