"""HTTP controllers for the assets library.

Auth note: these routes are intentionally NOT gated behind
``get_current_user`` in this iteration — the canvas UI does not yet
have a login flow. The model has nullable ``source_*`` columns so the
data is forward-compatible; when login lands, add a ``user_id`` column
and a dependency to filter rows."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.models import User
from ..library_db import get_db
from .schemas import AssetCreate, AssetOut, AssetUpdate
from .service import AssetService

router = APIRouter(prefix="/api/assets", tags=["assets"])


@router.post("", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
def create_asset(
    payload: AssetCreate,
    db: Session = Depends(get_db),
    _current: User = Depends(get_current_user),
) -> AssetOut:
    try:
        asset = AssetService(db).create(payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return AssetOut.model_validate(asset)


@router.get("", response_model=list[AssetOut])
def list_assets(
    kind: Literal["image", "video", "text", "caption"] | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[AssetOut]:
    items = AssetService(db).list(kind=kind)
    return [AssetOut.model_validate(a) for a in items]


@router.patch("/{asset_id}", response_model=AssetOut)
def update_asset(
    asset_id: str,
    payload: AssetUpdate,
    db: Session = Depends(get_db),
    _current: User = Depends(get_current_user),
) -> AssetOut:
    asset = AssetService(db).update(asset_id, payload)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="asset not found")
    return AssetOut.model_validate(asset)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    _current: User = Depends(get_current_user),
) -> None:
    if not AssetService(db).delete(asset_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="asset not found")
