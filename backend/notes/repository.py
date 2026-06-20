"""Repository — only module that touches the ORM for Notes."""

from __future__ import annotations

from sqlalchemy import select

from ..library_db import CRUDRepo
from .models import Note


class NoteRepository(CRUDRepo):
    """CRUD over the notes table.

    Inherits the standard CRUD verbs from
    :class:`backend.library_db.CRUDRepo`; only the per-node listing
    is bespoke.
    """

    model = Note

    def list(self, *, node_id: str | None = None, limit: int = 500) -> list[Note]:
        stmt = select(Note)
        if node_id:
            stmt = stmt.where(Note.node_id == node_id)
        stmt = stmt.order_by(Note.created_at.desc()).limit(limit)
        return list(self._db.execute(stmt).scalars().all())
