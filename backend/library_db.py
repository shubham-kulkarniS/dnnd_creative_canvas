"""Shared SQLAlchemy engine / SessionLocal for the non-auth persistence
layers (assets, sessions, …).

Auth keeps its own engine on purpose — different lifecycle, different
URL — but the rest of the app's "library" tables share one connection
pool and one SQLite file by default.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

log = logging.getLogger(__name__)


class LibraryBase(DeclarativeBase):
    """Shared declarative base for the library tables (assets/sessions/…)."""


_DEFAULT_URL = f"sqlite:///{Path('./data/library.db').resolve()}"
_url = os.environ.get("LIBRARY_DB_URL", _DEFAULT_URL)

_engine_kwargs: dict = {"future": True}
if _url.startswith("sqlite"):
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(_url, **_engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db() -> None:
    """Create library tables if missing.

    Subpackages import their model modules and call this from app
    startup. SQLAlchemy creates only the tables declared on
    ``LibraryBase.metadata`` at that point.
    """
    if _url.startswith("sqlite:///"):
        Path(_url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    # Importing here ensures any subpackage's model module has been
    # loaded before we ask SQLAlchemy to emit DDL.
    LibraryBase.metadata.create_all(bind=engine)
    _apply_lightweight_migrations()
    log.info("library: schema ready at %s", _url)


def _apply_lightweight_migrations() -> None:
    """Add columns that newer code expects to pre-existing tables.

    SQLAlchemy ``create_all`` does not ALTER existing tables, so a
    feature like "sessions now have an owner" would silently break on
    a DB created by an older revision. We keep this list small and
    idempotent — for anything beyond a single ALTER, reach for Alembic.
    """
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    if "canvas_sessions" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("canvas_sessions")}
        if "owner_user_id" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE canvas_sessions ADD COLUMN owner_user_id INTEGER"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_canvas_sessions_owner_user_id "
                    "ON canvas_sessions (owner_user_id)"
                ))
            log.info("library: migrated canvas_sessions.owner_user_id")


def get_db() -> Iterator[Session]:
    """FastAPI dependency: request-scoped Session with guaranteed close."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class CRUDRepo:
    """Mix-in base for the small CRUD repositories that wrap a single
    ORM model.

    Each subclass declares ``model`` as a class attribute and inherits
    five methods that previously had to be re-implemented per
    repository: ``get / create / update / delete / commit``. ``list``
    is intentionally NOT in the base because every repo orders by a
    different column and may need extra ``WHERE`` clauses \u2014 callers
    write their own, but ``_select`` / ``_query_all`` keep that as a
    one-liner.

    Update accepts only non-``None`` values so partial PATCH payloads
    leave existing columns alone.
    """

    model: type  # subclasses must set this

    def __init__(self, db: Session) -> None:
        self._db = db

    def get(self, pk):
        return self._db.get(self.model, pk)

    def create(self, **fields):
        obj = self.model(**fields)
        self._db.add(obj)
        self._db.flush()
        return obj

    def update(self, obj, **fields):
        for k, v in fields.items():
            if v is not None:
                setattr(obj, k, v)
        self._db.flush()
        return obj

    def delete(self, obj) -> None:
        self._db.delete(obj)
        self._db.flush()

    def commit(self) -> None:
        self._db.commit()
