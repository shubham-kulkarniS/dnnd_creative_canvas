"""Database engine + session factory for the auth subsystem.

Uses a sync SQLAlchemy engine because the rest of the backend already
offloads blocking work via ``run_in_threadpool``. SQLite is the default
so the app boots out-of-the-box; swap ``AUTH_DB_URL`` for a managed
Postgres in production.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from ..config import get_settings
from .models import Base

log = logging.getLogger(__name__)

_settings = get_settings()

# ``check_same_thread=False`` is required for SQLite when the engine is
# shared across the FastAPI threadpool workers.
_engine_kwargs: dict = {"future": True}
if _settings.auth_db_url.startswith("sqlite"):
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(_settings.auth_db_url, **_engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db() -> None:
    """Create tables if they don't already exist.

    Called once at app startup via the FastAPI lifespan handler so the
    server boots cleanly on a fresh checkout. For real deployments,
    prefer Alembic migrations.
    """
    # Ensure the SQLite file's parent dir exists.
    if _settings.auth_db_url.startswith("sqlite:///"):
        path = Path(_settings.auth_db_url.removeprefix("sqlite:///"))
        path.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    _apply_lightweight_migrations()
    log.info("auth: schema ready at %s", _settings.auth_db_url)


def _apply_lightweight_migrations() -> None:
    """Pre-existing ``users`` tables predate the ``is_admin`` column —
    add it on the fly. Keep this list short; use Alembic for anything
    bigger."""
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    if "users" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("users")}
        if "is_admin" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"
                ))
            log.info("auth: migrated users.is_admin")


def get_db() -> Iterator[Session]:
    """FastAPI dependency that yields a request-scoped Session and
    guarantees close on exit (even when the handler raises)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
