"""Repository for canvas sessions."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import CanvasSession, SessionShare


class SessionRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get(self, session_id: str) -> CanvasSession | None:
        return self._db.get(CanvasSession, session_id)

    def get_by_name_for_owner(self, name: str, owner_user_id: int | None) -> CanvasSession | None:
        """Find a session by its lower-cased name within the caller's
        own namespace. ``owner_user_id=None`` selects legacy / anon
        rows."""
        stmt = select(CanvasSession).where(
            CanvasSession.name == name.strip().lower(),
            CanvasSession.owner_user_id.is_(None) if owner_user_id is None
                else CanvasSession.owner_user_id == owner_user_id,
        )
        return self._db.execute(stmt).scalar_one_or_none()

    def list_for_user(self, user_id: int, *, limit: int = 200) -> list[CanvasSession]:
        """Sessions owned by ``user_id`` plus those shared with them."""
        shared_ids = select(SessionShare.session_id).where(SessionShare.user_id == user_id)
        stmt = (
            select(CanvasSession)
            .where(
                (CanvasSession.owner_user_id == user_id)
                | (CanvasSession.id.in_(shared_ids))
            )
            .order_by(CanvasSession.updated_at.desc())
            .limit(limit)
        )
        return list(self._db.execute(stmt).scalars().all())

    def list_all(self, *, limit: int = 500) -> list[CanvasSession]:
        """Admin-only — every session including legacy un-owned ones."""
        stmt = select(CanvasSession).order_by(CanvasSession.updated_at.desc()).limit(limit)
        return list(self._db.execute(stmt).scalars().all())

    def count(self) -> int:
        return int(self._db.execute(select(func.count(CanvasSession.id))).scalar_one() or 0)

    def create(self, **fields) -> CanvasSession:
        sess = CanvasSession(**fields)
        self._db.add(sess)
        self._db.flush()
        return sess

    def update(self, sess: CanvasSession, **fields) -> CanvasSession:
        for k, v in fields.items():
            setattr(sess, k, v)
        self._db.flush()
        return sess

    def delete(self, sess: CanvasSession) -> None:
        # Tear down any shares first — the share table has no FK.
        self._db.query(SessionShare).filter(SessionShare.session_id == sess.id).delete()
        self._db.delete(sess)
        self._db.flush()

    # ── shares ──────────────────────────────────────────────────────
    def list_shares(self, session_id: str) -> list[SessionShare]:
        stmt = select(SessionShare).where(SessionShare.session_id == session_id)
        return list(self._db.execute(stmt).scalars().all())

    def list_shared_session_ids_for_user(self, user_id: int) -> set[str]:
        """Return the set of session ids explicitly shared *with* ``user_id``
        (i.e. rows where they are the recipient, not the owner)."""
        stmt = select(SessionShare.session_id).where(SessionShare.user_id == user_id)
        return set(self._db.execute(stmt).scalars().all())

    def share_exists(self, session_id: str, user_id: int) -> bool:
        return self._db.get(SessionShare, (session_id, user_id)) is not None

    def add_share(self, session_id: str, user_id: int) -> SessionShare:
        share = SessionShare(session_id=session_id, user_id=user_id)
        self._db.add(share)
        self._db.flush()
        return share

    def remove_share(self, session_id: str, user_id: int) -> bool:
        share = self._db.get(SessionShare, (session_id, user_id))
        if share is None:
            return False
        self._db.delete(share)
        self._db.flush()
        return True

    def commit(self) -> None:
        self._db.commit()
