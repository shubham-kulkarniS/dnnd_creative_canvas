"""SessionService — save / load / list / delete / share canvas sessions.

"Save" is upsert by (owner, lower(name)) so the user's Save button
can do the right thing whether the session is brand-new or being
re-saved.

Authorisation lives here (not in the routes): the route layer only
passes the calling user id and re-raises the service's exceptions as
the appropriate HTTP error.
"""

from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from .models import CanvasSession, SessionShare
from .repository import SessionRepository
from .schemas import SessionUpsert

log = logging.getLogger(__name__)


class SessionAccessError(Exception):
    """Raised when a user attempts an operation they don't own / share."""


class SessionService:
    def __init__(self, db: Session) -> None:
        self._repo = SessionRepository(db)

    # ── Save / upsert ───────────────────────────────────────────────
    def upsert(
        self,
        payload: SessionUpsert,
        *,
        owner_user_id: int | None,
    ) -> tuple[CanvasSession, bool]:
        """Save a graph under ``payload.name`` in ``owner_user_id``'s
        namespace. Returns ``(session, created)``."""
        display = payload.name.strip()
        if not display:
            raise ValueError("name is required")
        key = display.lower()
        graph_dict = payload.graph.model_dump(exclude_none=True)
        # Stable JSON encoding keeps the on-disk diff minimal across re-saves.
        graph_json = json.dumps(graph_dict, ensure_ascii=False, separators=(",", ":"))
        node_count = len(graph_dict.get("nodes", []))
        edge_count = len(graph_dict.get("connections", []))

        existing = self._repo.get_by_name_for_owner(key, owner_user_id)
        if existing is None:
            sess = self._repo.create(
                name=key,
                display_name=display,
                graph_json=graph_json,
                node_count=node_count,
                edge_count=edge_count,
                owner_user_id=owner_user_id,
            )
            self._repo.commit()
            return sess, True

        self._repo.update(
            existing,
            display_name=display,
            graph_json=graph_json,
            node_count=node_count,
            edge_count=edge_count,
        )
        self._repo.commit()
        return existing, False

    # ── Reads ──────────────────────────────────────────────────────
    def list_for_user(self, user_id: int) -> list[CanvasSession]:
        return self._repo.list_for_user(user_id)

    def list_all(self) -> list[CanvasSession]:
        return self._repo.list_all()

    def get(self, session_id: str) -> tuple[CanvasSession, dict] | None:
        sess = self._repo.get(session_id)
        if sess is None:
            return None
        try:
            graph = json.loads(sess.graph_json)
        except json.JSONDecodeError:
            graph = {"nodes": [], "connections": []}
        return sess, graph

    def can_read(self, sess: CanvasSession, user_id: int | None, *, is_admin: bool = False) -> bool:
        """Read-permission predicate. Admins see everything; owners see
        their own; sharees see what was shared with them; anonymous
        callers see only legacy un-owned rows."""
        if is_admin:
            return True
        if sess.owner_user_id is None:
            return user_id is None or is_admin
        if user_id is None:
            return False
        if sess.owner_user_id == user_id:
            return True
        return self._repo.share_exists(sess.id, user_id)

    def can_write(self, sess: CanvasSession, user_id: int | None, *, is_admin: bool = False) -> bool:
        """Only the owner (or an admin) may delete or change sharing."""
        if is_admin:
            return True
        if sess.owner_user_id is None:
            # Legacy rows — anonymous callers retain full access in
            # dev. Once you log in, you cannot mutate them.
            return user_id is None
        return user_id == sess.owner_user_id

    # ── Delete ─────────────────────────────────────────────────────
    def delete(self, session_id: str, *, user_id: int | None, is_admin: bool = False) -> bool:
        sess = self._repo.get(session_id)
        if sess is None:
            return False
        if not self.can_write(sess, user_id, is_admin=is_admin):
            raise SessionAccessError("not authorised to delete this session")
        self._repo.delete(sess)
        self._repo.commit()
        return True

    # ── Sharing ────────────────────────────────────────────────────
    def list_shares(self, session_id: str) -> list[SessionShare]:
        return self._repo.list_shares(session_id)

    def share(self, session_id: str, *, owner_user_id: int, recipient_user_id: int) -> SessionShare | None:
        """Idempotent: returns the existing row if the share already
        exists, otherwise the new row. ``None`` if the session is gone."""
        sess = self._repo.get(session_id)
        if sess is None:
            return None
        if sess.owner_user_id != owner_user_id:
            raise SessionAccessError("only the owner can share this session")
        if recipient_user_id == owner_user_id:
            raise ValueError("cannot share a session with its owner")
        if self._repo.share_exists(session_id, recipient_user_id):
            # Treat as success — the caller's intent is "this user
            # should have access" and they do.
            return next(
                (s for s in self._repo.list_shares(session_id) if s.user_id == recipient_user_id),
                None,
            )
        share = self._repo.add_share(session_id, recipient_user_id)
        self._repo.commit()
        return share

    def unshare(self, session_id: str, *, owner_user_id: int, recipient_user_id: int) -> bool:
        sess = self._repo.get(session_id)
        if sess is None:
            return False
        if sess.owner_user_id != owner_user_id:
            raise SessionAccessError("only the owner can change sharing")
        removed = self._repo.remove_share(session_id, recipient_user_id)
        if removed:
            self._repo.commit()
        return removed
