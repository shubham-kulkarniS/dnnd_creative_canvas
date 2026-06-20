"""Note ORM model.

A note captures a director's review comment against a specific canvas
output. We snapshot enough metadata about the source node
(``node_title``, ``node_kind``, ``preview_value``) so the note remains
useful after the canvas node is gone or its value has changed.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..library_db import LibraryBase


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex


class Note(LibraryBase):
    __tablename__ = "notes"

    id:             Mapped[str]      = mapped_column(String(32), primary_key=True, default=_new_id)
    # The actual note body — the director's words.
    text:           Mapped[str]      = mapped_column(Text, nullable=False)

    # Source-node snapshot. Client node ids are local-only strings (no
    # FK enforced) so the note survives node deletion / session reload.
    node_id:        Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    node_title:     Mapped[str | None] = mapped_column(String(160), nullable=True)
    # 'text' | 'image' | 'video' | 'caption' — same vocabulary as Asset.kind.
    node_kind:      Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    # /media/... URL (binary) or short text snippet (text/caption).
    # Truncated by the service layer before insert.
    preview_value:  Mapped[str | None] = mapped_column(Text, nullable=True)

    # Optional link to the asset library entry if one existed at note
    # time. Not a true FK so deleting an asset doesn't cascade-clear
    # historical notes about it.
    asset_id:       Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)

    # Optional human label for "which review session is this from?".
    session_label:  Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)

    created_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, index=True)
    updated_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Note {self.id} node={self.node_id} text={self.text[:24]!r}>"
