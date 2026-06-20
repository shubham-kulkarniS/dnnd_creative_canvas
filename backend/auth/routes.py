"""HTTP controllers for the auth subsystem.

Routes stay deliberately thin: parse the request (Pydantic), delegate
to ``AuthService``, set/clear cookies, return a ``UserOut`` projection.
No business rules or DB queries here.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..config import get_settings
from .db import get_db
from .dependencies import (
    ACCESS_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    get_current_user,
)
from .models import User
from .schemas import LoginIn, MessageOut, SignupIn, UserOut
from .service import AuthError, AuthService, EmailAlreadyRegistered

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Refresh cookies are pinned to the auth subtree so they are never sent
# on plain API calls — only on /refresh and /logout. Reduces the
# blast radius of a leaked refresh token.
_REFRESH_COOKIE_PATH = "/api/auth"
_ACCESS_COOKIE_PATH  = "/"


def _set_auth_cookies(
    response: Response,
    *,
    access_token: str,
    access_exp: datetime,
    refresh_token: str,
    refresh_exp: datetime,
) -> None:
    """Write HttpOnly, SameSite=strict cookies. Secure flag is driven
    by config — must be True over HTTPS in production."""
    s = get_settings()
    now_ts = datetime.now(tz=access_exp.tzinfo).timestamp()
    common = {
        "httponly": True,                   # blocks JS from reading the token
        "secure":   s.auth_cookie_secure,   # require TLS
        "samesite": s.auth_cookie_samesite, # blocks cross-site CSRF
        "domain":   s.auth_cookie_domain,
    }
    response.set_cookie(
        key=ACCESS_COOKIE_NAME,
        value=access_token,
        max_age=max(0, int(access_exp.timestamp() - now_ts)),
        path=_ACCESS_COOKIE_PATH,
        **common,
    )
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        max_age=max(0, int(refresh_exp.timestamp() - now_ts)),
        path=_REFRESH_COOKIE_PATH,
        **common,
    )


def _clear_auth_cookies(response: Response) -> None:
    s = get_settings()
    common = {
        "httponly": True,
        "secure":   s.auth_cookie_secure,
        "samesite": s.auth_cookie_samesite,
        "domain":   s.auth_cookie_domain,
    }
    response.delete_cookie(ACCESS_COOKIE_NAME,  path=_ACCESS_COOKIE_PATH,  **common)
    response.delete_cookie(REFRESH_COOKIE_NAME, path=_REFRESH_COOKIE_PATH, **common)


# ── Routes ────────────────────────────────────────────────────────────


@router.post(
    "/signup",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
)
def signup(payload: SignupIn, response: Response, db: Session = Depends(get_db)) -> User:
    svc = AuthService(db)
    try:
        user = svc.signup(payload)
    except EmailAlreadyRegistered:
        # Trade-off: a 409 here does reveal that the email is taken. The
        # spec calls for a generic message on *authentication* failures
        # (login); signup has the inverse pressure (clear UX). Most
        # mature APIs accept this trade. Swap to a generic 200 + email
        # confirmation flow if enumeration is unacceptable for you.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already registered")
    # Immediately log the user in by issuing tokens.
    tokens = svc.issue_token_pair(user)
    _set_auth_cookies(response, **tokens)
    return user


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)) -> User:
    svc = AuthService(db)
    try:
        user = svc.authenticate(payload)
    except AuthError:
        # Generic message: do not disclose whether email exists.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid email or password",
        )
    tokens = svc.issue_token_pair(user)
    _set_auth_cookies(response, **tokens)
    return user


@router.post("/logout", response_model=MessageOut)
def logout(
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageOut:
    # Server-side revocation: invalidates every outstanding refresh
    # token for this user. Then clear both cookies on the response.
    AuthService(db).logout(current_user)
    _clear_auth_cookies(response)
    return MessageOut(detail="logged out")


@router.post("/refresh", response_model=UserOut)
def refresh(
    response: Response,
    db: Session = Depends(get_db),
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
) -> User:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated")
    try:
        user, tokens = AuthService(db).refresh(refresh_token)
    except AuthError:
        _clear_auth_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated")
    _set_auth_cookies(response, **tokens)
    return user


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> User:
    """Protected route — returns the authenticated user's profile."""
    return current_user
