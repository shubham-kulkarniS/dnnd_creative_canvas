"""HTTP controllers for director review notes.

Auth note: like assets/sessions, these routes are intentionally NOT
gated behind ``get_current_user`` in this iteration — the canvas UI
does not yet have a login flow. When login lands, add a ``user_id``
column to the Note model and a dependency that filters by it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.models import User
from ..library_db import get_db
from .schemas import NoteCreate, NoteOut, NoteUpdate
from .service import NoteService

router = APIRouter(prefix="/api/notes", tags=["notes"])


@router.post("", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def create_note(
    payload: NoteCreate,
    db: Session = Depends(get_db),
    _current: User = Depends(get_current_user),
) -> NoteOut:
    try:
        note = NoteService(db).create(payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return NoteOut.model_validate(note)


@router.get("", response_model=list[NoteOut])
def list_notes(
    node_id: str | None = Query(default=None, max_length=64),
    db: Session = Depends(get_db),
) -> list[NoteOut]:
    items = NoteService(db).list(node_id=node_id)
    return [NoteOut.model_validate(n) for n in items]


@router.patch("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: str,
    payload: NoteUpdate,
    db: Session = Depends(get_db),
    _current: User = Depends(get_current_user),
) -> NoteOut:
    try:
        note = NoteService(db).update(note_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="note not found")
    return NoteOut.model_validate(note)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: str,
    db: Session = Depends(get_db),
    _current: User = Depends(get_current_user),
) -> None:
    if not NoteService(db).delete(note_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="note not found")
