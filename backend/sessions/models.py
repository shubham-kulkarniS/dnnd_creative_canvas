"""Saved-session ORM model.

A session is a named, versioned snapshot of the canvas graph
(``{nodes, connections, view}``) stored as JSON. Names are unique
*per owner* (case-insensitive at the service layer) so the "Save" UI
can offer upsert semantics without ambiguity.

``owner_user_id`` is an integer reference (NOT a SQL FK) into the
auth DB's ``users.id`` — the two subsystems run on separate engines
so the database can't enforce the relationship for us. Sessions
created before login was wired ("legacy") have ``owner_user_id IS
NULL``; only admins see them.

``SessionShare`` records "owner has shared this session with this
user id" — both columns form the composite primary key so the
same pair can't be inserted twice.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..library_db import LibraryBase


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex


class CanvasSession(LibraryBase):
    __tablename__ = "canvas_sessions"
    # Per-owner uniqueness is enforced at the service layer (see
    # ``SessionService.upsert``). We don't declare a DB unique
    # constraint because adding one to an existing SQLite file is a
    # migration: ``create_all`` only creates new tables, never alters
    # existing ones. Fresh deployments still benefit because the
    # service code is the single writer.

    id:             Mapped[str]      = mapped_column(String(32), primary_key=True, default=_new_id)
    # Stored lowercased to keep "MySession" and "mysession" from
    # colliding from the user's POV.
    name:           Mapped[str]      = mapped_column(String(120), index=True, nullable=False)
    # Pretty name as the user typed it (for display).
    display_name:   Mapped[str]      = mapped_column(String(120), nullable=False)
    graph_json:     Mapped[str]      = mapped_column(Text, nullable=False)
    # Counts surfaced in the list view without parsing graph_json.
    node_count:     Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    edge_count:     Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    # Soft reference into auth users.id. Nullable so pre-login rows
    # remain readable; the service layer requires an owner on create.
    owner_user_id:  Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    created_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)


class SessionShare(LibraryBase):
    """One row per (session, recipient-user) pair."""
    __tablename__ = "canvas_session_shares"

    session_id: Mapped[str] = mapped_column(String(32), primary_key=True, index=True)
    user_id:    Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
