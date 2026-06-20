"""Repository — only module that touches the ORM for Assets."""

from __future__ import annotations

from sqlalchemy import select

from ..library_db import CRUDRepo
from .models import Asset


class AssetRepository(CRUDRepo):
    """CRUD over the assets table.

    Inherits ``get / create / update / delete / commit`` from
    :class:`backend.library_db.CRUDRepo`; the only specialised query
    is the kind-filtered list.
    """

    model = Asset

    def list(self, *, kind: str | None = None, limit: int = 200) -> list[Asset]:
        stmt = select(Asset)
        if kind:
            stmt = stmt.where(Asset.kind == kind)
        stmt = stmt.order_by(Asset.created_at.desc()).limit(limit)
        return list(self._db.execute(stmt).scalars().all())
