"""HTTP routes for the saved-sessions library.

Now auth-gated:
  * Anonymous callers see only legacy un-owned sessions (read-only).
  * Authenticated callers see only their own + sessions shared with them.
  * Only the owner can delete or change sharing.
  * Admins can list/read everything (handy for the dashboard).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth.db import SessionLocal as AuthSessionLocal
from ..auth.dependencies import get_current_user_optional
from ..auth.models import User
from ..auth.repository import UserRepository
from ..library_db import get_db
from .schemas import SessionDetail, SessionSummary, SessionUpsert, ShareIn, ShareOut
from .service import SessionAccessError, SessionService

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _summary(sess, *, user_id: int | None, shared_ids: frozenset[str] = frozenset()) -> SessionSummary:
    """Build the wire summary. ``shared_ids`` must be the set of session ids
    explicitly shared *with* ``user_id`` so the flag is accurate."""
    return SessionSummary(
        id=sess.id,
        name=sess.name,
        display_name=sess.display_name,
        node_count=sess.node_count,
        edge_count=sess.edge_count,
        owner_user_id=sess.owner_user_id,
        is_owner=(user_id is not None and sess.owner_user_id == user_id),
        shared_with_me=(user_id is not None and sess.id in shared_ids),
        created_at=sess.created_at,
        updated_at=sess.updated_at,
    )


@router.get("", response_model=list[SessionSummary])
def list_sessions(
    db: Session = Depends(get_db),
    current: User | None = Depends(get_current_user_optional),
) -> list[SessionSummary]:
    svc = SessionService(db)
    if current is None:
        # Backwards-compat: anonymous mode returns legacy un-owned rows.
        items = [s for s in svc.list_all() if s.owner_user_id is None]
        shared_ids: frozenset[str] = frozenset()
    elif current.is_admin:
        items = svc.list_all()
        shared_ids = frozenset(svc.get_shared_session_ids(current.id))
    else:
        items = svc.list_for_user(current.id)
        shared_ids = frozenset(svc.get_shared_session_ids(current.id))
    uid = current.id if current else None
    return [_summary(s, user_id=uid, shared_ids=shared_ids) for s in items]


@router.post("", response_model=SessionDetail)
def save_session(
    payload: SessionUpsert,
    db: Session = Depends(get_db),
    current: User | None = Depends(get_current_user_optional),
) -> SessionDetail:
    try:
        sess, _created = SessionService(db).upsert(
            payload, owner_user_id=current.id if current else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    uid = current.id if current else None
    # A just-saved session is always owned by the saver — never shared_with_me.
    summary = _summary(sess, user_id=uid, shared_ids=frozenset())
    return SessionDetail(**summary.model_dump(), graph=payload.graph)


@router.get("/{session_id}", response_model=SessionDetail)
def get_session(
    session_id: str,
    db: Session = Depends(get_db),
    current: User | None = Depends(get_current_user_optional),
) -> SessionDetail:
    svc = SessionService(db)
    result = svc.get(session_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    sess, graph = result
    uid = current.id if current else None
    if not svc.can_read(sess, uid, is_admin=bool(current and current.is_admin)):
        # Don't leak existence to callers without permission.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    shared_ids = frozenset(svc.get_shared_session_ids(uid)) if uid else frozenset()
    summary = _summary(sess, user_id=uid, shared_ids=shared_ids)
    return SessionDetail(**summary.model_dump(), graph=graph)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: str,
    db: Session = Depends(get_db),
    current: User | None = Depends(get_current_user_optional),
) -> None:
    try:
        ok = SessionService(db).delete(
            session_id,
            user_id=current.id if current else None,
            is_admin=bool(current and current.is_admin),
        )
    except SessionAccessError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")


# ── Sharing ──────────────────────────────────────────────────────────


def _list_users_by_ids(user_ids: list[int]) -> dict[int, User]:
    """Bulk-load users from the auth DB by id. Uses its own short-lived
    session because auth/library run on separate engines."""
    if not user_ids:
        return {}
    db = AuthSessionLocal()
    try:
        rows = db.query(User).filter(User.id.in_(user_ids)).all()
        return {u.id: u for u in rows}
    finally:
        db.close()


def _resolve_user_by_email(email: str) -> User | None:
    db = AuthSessionLocal()
    try:
        return UserRepository(db).get_by_email(email)
    finally:
        db.close()


def _share_out(share, user_lookup: dict[int, User]) -> ShareOut:
    u = user_lookup.get(share.user_id)
    return ShareOut(
        session_id=share.session_id,
        user_id=share.user_id,
        email=(u.email if u else None),
        display_name=(u.display_name if u else None),
        created_at=share.created_at,
    )


@router.get("/{session_id}/shares", response_model=list[ShareOut])
def list_session_shares(
    session_id: str,
    db: Session = Depends(get_db),
    current: User | None = Depends(get_current_user_optional),
) -> list[ShareOut]:
    svc = SessionService(db)
    result = svc.get(session_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    sess, _ = result
    # Only the owner (or an admin) should know the share list.
    if not svc.can_write(sess, current.id if current else None,
                         is_admin=bool(current and current.is_admin)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not authorised")
    shares = svc.list_shares(session_id)
    lookup = _list_users_by_ids([s.user_id for s in shares])
    return [_share_out(s, lookup) for s in shares]


@router.post("/{session_id}/share", response_model=ShareOut, status_code=status.HTTP_201_CREATED)
def share_session(
    session_id: str,
    payload: ShareIn,
    db: Session = Depends(get_db),
    current: User | None = Depends(get_current_user_optional),
) -> ShareOut:
    if current is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated")
    recipient = _resolve_user_by_email(str(payload.email))
    if recipient is None:
        # Don't leak whether the email is in the system; for sharing we
        # actually want the owner to learn this — they need to know if
        # the recipient hasn't signed up yet. So a clear 404 is OK here.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="recipient not found")
    try:
        share = SessionService(db).share(
            session_id,
            owner_user_id=current.id,
            recipient_user_id=recipient.id,
        )
    except SessionAccessError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    return _share_out(share, {recipient.id: recipient})


@router.delete("/{session_id}/share/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def unshare_session(
    session_id: str,
    user_id: int,
    db: Session = Depends(get_db),
    current: User | None = Depends(get_current_user_optional),
) -> None:
    if current is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated")
    try:
        ok = SessionService(db).unshare(
            session_id,
            owner_user_id=current.id,
            recipient_user_id=user_id,
        )
    except SessionAccessError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
