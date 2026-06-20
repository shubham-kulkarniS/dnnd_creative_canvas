"""Asset ORM model.

``kind`` mirrors the data-node ``dataType`` plus ``caption`` (text from
image/video). Binary kinds (image/video) store a ``/media/...`` URL in
``value``; text-y kinds store the raw text in ``value``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..library_db import LibraryBase


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    # UUIDv4 as a 32-char hex string — compact + URL-safe + sortable enough
    # by ``created_at`` indexing.
    return uuid.uuid4().hex


class Asset(LibraryBase):
    __tablename__ = "assets"

    id:                Mapped[str]      = mapped_column(String(32), primary_key=True, default=_new_id)
    # 'image' | 'video' | 'text' | 'caption'
    kind:              Mapped[str]      = mapped_column(String(16), nullable=False, index=True)
    # Human label set by the user at save time.
    label:             Mapped[str | None] = mapped_column(String(160), nullable=True)
    # Either a /media/... URL (binary kinds) or raw text (text kinds).
    value:             Mapped[str]      = mapped_column(Text, nullable=False)
    mime:              Mapped[str | None] = mapped_column(String(80), nullable=True)
    bytes:             Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Provenance — useful for "where did this come from?" tooltips. Not
    # FKs because canvas node ids are client-local strings.
    source_node_id:    Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at:        Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, index=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Asset {self.id} kind={self.kind} label={self.label!r}>"
