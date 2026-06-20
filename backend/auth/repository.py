"""Repository — the only module that touches the ORM directly.

Keeping persistence behind this thin facade lets the service layer be
unit-tested with an in-memory fake and lets the backing store swap
(e.g. to Postgres + asyncpg) without touching business logic.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import User


class UserRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_id(self, user_id: int) -> User | None:
        return self._db.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        # ``email`` is stored lowercased; normalise the lookup too.
        stmt = select(User).where(User.email == email.strip().lower())
        return self._db.execute(stmt).scalar_one_or_none()

    def list_all(self, *, limit: int = 500) -> list[User]:
        """Admin-only listing of all users (newest-first)."""
        stmt = select(User).order_by(User.created_at.desc()).limit(limit)
        return list(self._db.execute(stmt).scalars().all())

    def count(self) -> int:
        return int(self._db.execute(select(func.count(User.id))).scalar_one() or 0)

    def create(self, *, email: str, password_hash: str, display_name: str | None, is_admin: bool = False) -> User:
        user = User(
            email=email.strip().lower(),
            password_hash=password_hash,
            display_name=display_name,
            is_admin=is_admin,
        )
        self._db.add(user)
        self._db.flush()  # populate user.id without committing
        return user

    def bump_token_version(self, user: User) -> None:
        """Invalidate all outstanding refresh tokens for this user."""
        user.token_version += 1
        self._db.flush()

    def update_password_hash(self, user: User, new_hash: str) -> None:
        user.password_hash = new_hash
        self._db.flush()

    def commit(self) -> None:
        self._db.commit()
