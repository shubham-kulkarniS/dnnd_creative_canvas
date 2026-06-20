"""Admin endpoints — usage dashboard + user directory.

Read-only and admin-only. The dashboard intentionally aggregates from
the existing repositories rather than maintaining its own counters so
we don't get drift between "what the dashboard shows" and "what
actually exists".
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..assets.models import Asset  # noqa: F401  (imported so the assets table loads with the dashboard)
from ..auth.db import get_db as get_auth_db
from ..auth.dependencies import get_current_user, require_admin
from ..auth.models import User
from ..auth.repository import UserRepository
from ..auth.schemas import UserSummary
from ..library_db import get_db as get_library_db
from ..notes.models import Note
from ..sessions.models import CanvasSession

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ── Schemas (local — only the admin surface uses them) ───────────────


class UserAdminOut(BaseModel):
    """Full admin projection — includes flags + timestamps that
    ``UserSummary`` deliberately omits."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    display_name: str | None
    is_admin: bool
    created_at: datetime


class UsageOut(BaseModel):
    users: int
    admins: int
    sessions: int
    sessions_legacy: int    # rows with NULL owner — pre-auth backlog
    shares: int
    assets: int
    notes: int
    # Lightweight activity feed: most-recently-touched things.
    recent_sessions: list[dict[str, Any]]
    recent_notes: list[dict[str, Any]]


# ── Routes ───────────────────────────────────────────────────────────


@router.get("/usage", response_model=UsageOut)
def usage(
    _admin: User = Depends(require_admin),
    lib: Session = Depends(get_library_db),
    auth: Session = Depends(get_auth_db),
) -> UsageOut:
    """Aggregate dashboard numbers.

    Each connection runs ONE round-trip: scalar subqueries fold what
    used to be five separate ``SELECT COUNT(*)`` statements (library)
    and two (auth) into a single statement per engine. With SQLite
    that's a tiny win, but on a networked database it eliminates four
    sequential round-trips that would each cost a full RTT.
    """
    lib_row = lib.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM canvas_sessions)                                      AS sessions,
          (SELECT COUNT(*) FROM canvas_sessions WHERE owner_user_id IS NULL)          AS legacy,
          (SELECT COUNT(*) FROM canvas_session_shares)                                AS shares,
          (SELECT COUNT(*) FROM assets)                                               AS assets,
          (SELECT COUNT(*) FROM notes)                                                AS notes
    """)).one()
    auth_row = auth.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM users)                       AS users,
          (SELECT COUNT(*) FROM users WHERE is_admin = 1)    AS admins
    """)).one()

    recent_sessions = [
        {
            "id": s.id,
            "display_name": s.display_name,
            "node_count": s.node_count,
            "edge_count": s.edge_count,
            "owner_user_id": s.owner_user_id,
            "updated_at": s.updated_at.isoformat(),
        }
        for s in lib.execute(
            select(CanvasSession).order_by(CanvasSession.updated_at.desc()).limit(10)
        ).scalars()
    ]
    recent_notes = [
        {
            "id": n.id,
            "text": (n.text[:140] + "…") if len(n.text) > 140 else n.text,
            "node_kind": n.node_kind,
            "node_title": n.node_title,
            "created_at": n.created_at.isoformat(),
        }
        for n in lib.execute(
            select(Note).order_by(Note.created_at.desc()).limit(10)
        ).scalars()
    ]

    return UsageOut(
        users=int(auth_row.users or 0),
        admins=int(auth_row.admins or 0),
        sessions=int(lib_row.sessions or 0),
        sessions_legacy=int(lib_row.legacy or 0),
        shares=int(lib_row.shares or 0),
        assets=int(lib_row.assets or 0),
        notes=int(lib_row.notes or 0),
        recent_sessions=recent_sessions,
        recent_notes=recent_notes,
    )


@router.get("/users", response_model=list[UserAdminOut])
def list_users(
    _admin: User = Depends(require_admin),
    auth: Session = Depends(get_auth_db),
) -> list[UserAdminOut]:
    """Admin-only user directory (newest-first, capped)."""
    return [UserAdminOut.model_validate(u) for u in UserRepository(auth).list_all()]


# ── Public-ish lookup (used by Share UI) ────────────────────────────


users_router = APIRouter(prefix="/api/users", tags=["users"])


@users_router.get("/lookup", response_model=UserSummary | None)
def lookup_user(
    email: str,
    _viewer: User = Depends(get_current_user),
    auth: Session = Depends(get_auth_db),
) -> UserSummary | None:
    """Resolve an email to a tiny ``{id, email, display_name}`` projection.

    Authenticated callers only (anyone with an account can look up a
    fellow user to share with). Returns ``null`` if no match — the
    caller is the owner of a session who is about to share, so
    revealing whether the recipient exists is necessary UX.
    """
    user = UserRepository(auth).get_by_email(email)
    return UserSummary.model_validate(user) if user else None
