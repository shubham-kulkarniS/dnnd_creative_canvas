"""Password hashing + JWT helpers.

Isolated from the service layer so the algorithm choice can be swapped
in one place. argon2id is the OWASP-recommended modern KDF; it is
memory-hard (resistant to GPU/ASIC cracking) and self-tunes via the
embedded PHC params.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from ..config import get_settings

log = logging.getLogger(__name__)

# Default argon2id params (memory_cost=64 MiB, time_cost=3, parallelism=4)
# are within OWASP guidelines for 2024+.
_hasher = PasswordHasher()

TokenType = Literal["access", "refresh"]


# ── Passwords ─────────────────────────────────────────────────────────


def hash_password(password: str) -> str:
    """Return a PHC-formatted argon2id hash (includes algo + params + salt)."""
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time verification. Returns False on any mismatch or on a
    malformed stored hash — never raises so callers can produce a single
    generic error message (prevents user enumeration via timing/branching)."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, Exception):  # noqa: BLE001
        return False


def needs_rehash(password_hash: str) -> bool:
    """True when the stored hash uses weaker params than the current
    defaults — caller should re-hash on next successful login."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except Exception:  # noqa: BLE001
        return False


# ── JWT ───────────────────────────────────────────────────────────────


def _now() -> datetime:
    return datetime.now(timezone.utc)


def issue_token(
    *,
    user_id: int,
    token_version: int,
    token_type: TokenType,
) -> tuple[str, datetime]:
    """Sign and return ``(jwt_string, expiry)``.

    ``token_version`` is embedded so a server-side bump (logout, password
    change) invalidates outstanding refresh tokens.
    """
    s = get_settings()
    ttl = (
        timedelta(minutes=s.access_token_ttl_minutes)
        if token_type == "access"
        else timedelta(days=s.refresh_token_ttl_days)
    )
    issued_at = _now()
    expires_at = issued_at + ttl
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "typ": token_type,
        "tv":  token_version,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
        # jti gives every token a unique id — useful for later deny-list
        # support without changing the wire format.
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)
    return token, expires_at


class TokenError(Exception):
    """Raised by ``decode_token`` for any invalid / expired / wrong-type token."""


def decode_token(token: str, *, expected_type: TokenType) -> dict[str, Any]:
    """Verify signature + expiry and assert the token is of the expected kind.

    Returns the decoded claims dict. Raises ``TokenError`` on any
    failure — callers respond with a single generic 401.
    """
    s = get_settings()
    try:
        claims = jwt.decode(
            token,
            s.jwt_secret,
            algorithms=[s.jwt_algorithm],
            # Enforce presence of the standard claims we rely on.
            options={"require": ["exp", "iat", "sub", "typ"]},
        )
    except jwt.PyJWTError as e:
        raise TokenError(str(e)) from e
    if claims.get("typ") != expected_type:
        raise TokenError(f"expected {expected_type} token, got {claims.get('typ')!r}")
    return claims
