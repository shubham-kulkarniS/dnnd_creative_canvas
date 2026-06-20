"""Authentication dependencies.

``get_current_user`` is the ``isAuthenticated`` guard — use it on any
route that requires a logged-in user::

    @router.get("/private")
    async def private(user: User = Depends(get_current_user)):
        ...

It enforces:
  * the access-token cookie is present
  * the JWT signature + expiry are valid
  * the token's ``typ`` claim is ``"access"`` (refresh tokens cannot be
    used to access protected resources)
  * the referenced user still exists

All failures collapse to a single generic 401 so error messages cannot
be used to enumerate accounts.
"""

from __future__ import annotations

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .security import TokenError, decode_token
from .service import AuthService

ACCESS_COOKIE_NAME  = "access_token"
REFRESH_COOKIE_NAME = "refresh_token"

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="not authenticated",
    headers={"WWW-Authenticate": 'Cookie realm="auth"'},
)


def get_current_user(
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> User:
    if not access_token:
        raise _UNAUTHORIZED
    try:
        claims = decode_token(access_token, expected_type="access")
    except TokenError:
        raise _UNAUTHORIZED
    user = AuthService(db).get_user(int(claims["sub"]))
    if user is None:
        raise _UNAUTHORIZED
    return user


def get_current_user_optional(
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> User | None:
    """Like ``get_current_user`` but returns ``None`` for anonymous
    callers instead of raising. Use on routes that adapt their
    behaviour (e.g. legacy unowned sessions vs. owned ones) rather than
    refuse access outright."""
    if not access_token:
        return None
    try:
        claims = decode_token(access_token, expected_type="access")
    except TokenError:
        return None
    return AuthService(db).get_user(int(claims["sub"]))


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Gate for admin-only endpoints. Hides existence of the route
    from non-admins by returning the same generic 401 as
    ``get_current_user`` does — we choose 403 here because the caller
    IS authenticated; they just lack the role."""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin privileges required",
        )
    return user
