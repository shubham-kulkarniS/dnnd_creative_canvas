"""AssetService — business rules for the asset library."""

from __future__ import annotations

import logging
import re

from sqlalchemy.orm import Session

from .models import Asset
from .repository import AssetRepository
from .schemas import AssetCreate, AssetUpdate

log = logging.getLogger(__name__)


# Defence in depth: for binary assets, the ``value`` must reference media
# the server already owns (or an http(s) URL). Reject ``javascript:`` /
# ``file:`` etc. — they would otherwise round-trip back into the UI as a
# clickable link.
_SAFE_BINARY_VALUE = re.compile(r"^(/media/[\w.\-]+|https?://[^\s]+)$")


class AssetService:
    def __init__(self, db: Session) -> None:
        self._db = db
        self._repo = AssetRepository(db)

    def create(self, payload: AssetCreate) -> Asset:
        value = payload.value.strip()
        if payload.kind in ("image", "video"):
            if not _SAFE_BINARY_VALUE.match(value):
                raise ValueError(
                    "binary asset value must be a /media/... or http(s):// URL"
                )
        # text/caption: keep as-is (length is already bounded by the schema).
        asset = self._repo.create(
            kind=payload.kind,
            value=value,
            label=(payload.label or "").strip() or None,
            mime=payload.mime,
            bytes=payload.bytes,
            source_node_id=payload.source_node_id,
            source_session_id=payload.source_session_id,
        )
        self._repo.commit()
        return asset

    def list(self, *, kind: str | None = None) -> list[Asset]:
        return self._repo.list(kind=kind)

    def update(self, asset_id: str, payload: AssetUpdate) -> Asset | None:
        asset = self._repo.get(asset_id)
        if asset is None:
            return None
        # Only allow label updates for now (immutable bytes — see schema).
        self._repo.update(asset, label=(payload.label or "").strip() or None)
        self._repo.commit()
        return asset

    def delete(self, asset_id: str) -> bool:
        asset = self._repo.get(asset_id)
        if asset is None:
            return False
        self._repo.delete(asset)
        self._repo.commit()
        return True
