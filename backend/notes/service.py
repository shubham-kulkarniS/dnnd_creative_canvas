"""NoteService — business rules for director review notes."""

from __future__ import annotations

import logging
import re

from sqlalchemy.orm import Session

from .models import Note
from .repository import NoteRepository
from .schemas import NoteCreate, NoteUpdate

log = logging.getLogger(__name__)

# Cap on the snapshot we keep alongside the note. Binary kinds are URL
# refs so they're tiny; for text/caption we trim aggressively so the
# notes panel renders fast and the DB stays lean.
_PREVIEW_MAX = 400

# Defence in depth: a snapshotted preview that looks URL-shaped must
# point at our own /media/ or an http(s) origin. ``javascript:``,
# ``file:``, ``data:`` etc. are rejected so a note can't smuggle an
# active URL back into the notes panel.
_SAFE_URL = re.compile(r"^(/media/[\w.\-]+|https?://[^\s]+)$")


class NoteService:
    def __init__(self, db: Session) -> None:
        self._db = db
        self._repo = NoteRepository(db)

    def create(self, payload: NoteCreate) -> Note:
        text = payload.text.strip()
        if not text:
            raise ValueError("text cannot be empty")

        preview = self._safe_preview(payload.preview_value, payload.node_kind)

        note = self._repo.create(
            text=text,
            node_id=payload.node_id,
            node_title=(payload.node_title or "").strip() or None,
            node_kind=payload.node_kind,
            preview_value=preview,
            asset_id=payload.asset_id,
            session_label=(payload.session_label or "").strip() or None,
        )
        self._repo.commit()
        return note

    def list(self, *, node_id: str | None = None) -> list[Note]:
        return self._repo.list(node_id=node_id)

    def update(self, note_id: str, payload: NoteUpdate) -> Note | None:
        note = self._repo.get(note_id)
        if note is None:
            return None
        # Only text + session_label are user-editable. The node-snapshot
        # fields are immutable so the note keeps reflecting the moment
        # it was written.
        fields: dict[str, object] = {}
        if payload.text is not None:
            stripped = payload.text.strip()
            if not stripped:
                raise ValueError("text cannot be empty")
            fields["text"] = stripped
        if payload.session_label is not None:
            fields["session_label"] = payload.session_label.strip() or None
        if fields:
            self._repo.update(note, **fields)
            self._repo.commit()
        return note

    def delete(self, note_id: str) -> bool:
        note = self._repo.get(note_id)
        if note is None:
            return False
        self._repo.delete(note)
        self._repo.commit()
        return True

    # ── helpers ─────────────────────────────────────────────────────
    def _safe_preview(self, value: str | None, kind: str | None) -> str | None:
        if not value:
            return None
        v = value.strip()
        if not v:
            return None
        if kind in ("image", "video"):
            # Binary kinds must be a URL reference we own.
            if not _SAFE_URL.match(v):
                # Drop unsafe URLs silently — the note text still survives.
                return None
            return v[:_PREVIEW_MAX]
        # text / caption / unknown → trim for snippet display.
        return v[:_PREVIEW_MAX]
