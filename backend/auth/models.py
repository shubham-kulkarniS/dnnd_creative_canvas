"""ORM models for the auth subsystem.

Kept intentionally minimal — only the fields required by the spec.
``token_version`` is bumped on logout so all outstanding refresh tokens
become invalid (cheap server-side revocation without a deny-list).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id:             Mapped[int]      = mapped_column(Integer, primary_key=True)
    # Stored lower-cased to keep lookups case-insensitive and prevent
    # accidental duplicate registrations like "Foo@x.com" vs "foo@x.com".
    email:          Mapped[str]      = mapped_column(String(254), unique=True, index=True, nullable=False)
    # Full PHC-formatted argon2 hash — algorithm + params + salt + digest.
    # Never store plaintext, never store reversibly-encrypted passwords.
    password_hash:  Mapped[str]      = mapped_column(String(255), nullable=False)
    # Display name only (not used for auth). Optional.
    display_name:   Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Monotonic counter incremented on logout / password change. Embedded
    # in refresh tokens so old refresh tokens can be invalidated server
    # side without maintaining a per-token deny-list.
    token_version:  Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    # Admin flag — grants access to /api/admin/* (usage dashboard, user
    # list, view-all-sessions). Bootstrapped by ``AuthService.signup``:
    # the very first signup becomes admin, or any email listed in
    # ``AUTH_BOOTSTRAP_ADMIN_EMAILS`` is promoted on signup.
    is_admin:       Mapped[bool]     = mapped_column(Boolean, nullable=False, default=False)
    created_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    def __repr__(self) -> str:  # pragma: no cover - debugging only
        return f"<User id={self.id} email={self.email!r}>"
