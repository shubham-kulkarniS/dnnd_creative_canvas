"""AuthService — all business rules live here.

Routes call into the service; the service calls into the repository.
This keeps the HTTP layer free of policy decisions (which makes the
same rules reusable from a CLI, a worker, or tests).
"""

from __future__ import annotations

import logging
import os

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import User
from .repository import UserRepository
from .schemas import LoginIn, SignupIn
from .security import (
    TokenError,
    decode_token,
    hash_password,
    issue_token,
    needs_rehash,
    verify_password,
)

log = logging.getLogger(__name__)


def _bootstrap_admin_emails() -> set[str]:
    """Lower-cased set of emails that should be auto-promoted on signup.

    Read from ``AUTH_BOOTSTRAP_ADMIN_EMAILS`` — comma-separated. Used
    so an operator can pre-declare "this email is the admin" without
    racing on first signup.
    """
    raw = os.environ.get("AUTH_BOOTSTRAP_ADMIN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


# Sentinel exceptions — routes translate these into appropriate HTTP
# responses. Each carries an intentionally generic message so the same
# error text is surfaced regardless of which branch tripped (defence
# against user-enumeration via differing error messages).
class AuthError(Exception):
    """Generic authentication failure (bad creds / unknown user / etc.)."""


class EmailAlreadyRegistered(Exception):
    """Signup attempted with an already-registered email."""


class AuthService:
    def __init__(self, db: Session) -> None:
        self._db = db
        self._repo = UserRepository(db)

    # ── Signup ───────────────────────────────────────────────────────
    def signup(self, payload: SignupIn) -> User:
        # Pre-check is cheap and gives a clear 409 — the unique
        # constraint is the authoritative defence against a race.
        if self._repo.get_by_email(payload.email):
            raise EmailAlreadyRegistered()
        pwd_hash = hash_password(payload.password)
        # First user ever becomes admin; plus any email listed in the
        # bootstrap env var. This avoids a chicken-and-egg with no UI
        # to promote the initial admin.
        promote = (
            self._repo.count() == 0
            or payload.email.strip().lower() in _bootstrap_admin_emails()
        )
        try:
            user = self._repo.create(
                email=payload.email,
                password_hash=pwd_hash,
                display_name=payload.display_name,
                is_admin=promote,
            )
            self._repo.commit()
        except IntegrityError:
            # Lost the race against a concurrent signup with the same email.
            self._db.rollback()
            raise EmailAlreadyRegistered()
        return user

    # ── Login ────────────────────────────────────────────────────────
    def authenticate(self, payload: LoginIn) -> User:
        """Return the user on success; raise ``AuthError`` otherwise.

        We deliberately always run ``verify_password`` — even when the
        user does not exist — by verifying against a throwaway hash. This
        equalises timing so an attacker cannot use response-time
        differences to enumerate accounts.
        """
        user = self._repo.get_by_email(payload.email)
        if user is None:
            # Burn time on a real verification against a dummy hash.
            verify_password(payload.password, _dummy_hash())
            raise AuthError("invalid email or password")
        if not verify_password(payload.password, user.password_hash):
            raise AuthError("invalid email or password")
        # Opportunistic upgrade if argon2 params have been bumped.
        if needs_rehash(user.password_hash):
            self._repo.update_password_hash(user, hash_password(payload.password))
            self._repo.commit()
        return user

    # ── Token plumbing ───────────────────────────────────────────────
    def issue_token_pair(self, user: User) -> dict:
        access, access_exp = issue_token(
            user_id=user.id,
            token_version=user.token_version,
            token_type="access",
        )
        refresh, refresh_exp = issue_token(
            user_id=user.id,
            token_version=user.token_version,
            token_type="refresh",
        )
        return {
            "access_token":  access,
            "access_exp":    access_exp,
            "refresh_token": refresh,
            "refresh_exp":   refresh_exp,
        }

    def refresh(self, refresh_token: str) -> tuple[User, dict]:
        """Validate a refresh token and return ``(user, new_token_pair)``."""
        try:
            claims = decode_token(refresh_token, expected_type="refresh")
        except TokenError as e:
            raise AuthError(str(e))
        user = self._repo.get_by_id(int(claims["sub"]))
        if user is None or claims.get("tv") != user.token_version:
            # Either the user was deleted, or logout/password-change
            # bumped the version after this token was issued.
            raise AuthError("token revoked")
        return user, self.issue_token_pair(user)

    # ── Logout ───────────────────────────────────────────────────────
    def logout(self, user: User) -> None:
        """Server-side revoke: bump the user's token version so every
        outstanding refresh token is rejected. Live access tokens still
        validate until their (short) expiry; the cookie is cleared on
        the response so the client can no longer present them."""
        self._repo.bump_token_version(user)
        self._repo.commit()

    # ── Read ─────────────────────────────────────────────────────────
    def get_user(self, user_id: int) -> User | None:
        return self._repo.get_by_id(user_id)


# Constant-time decoy hash used when the email doesn't exist. We
# compute it lazily on first use (it costs ~100-250 ms with default
# argon2id params) so importing this module — in tests, in scripts,
# in every uvicorn --reload cycle — stays fast.
_DUMMY_HASH_CACHE: str | None = None


def _dummy_hash() -> str:
    global _DUMMY_HASH_CACHE
    if _DUMMY_HASH_CACHE is None:
        _DUMMY_HASH_CACHE = hash_password(
            "dummy_password_for_timing_equalisation_0!"
        )
    return _DUMMY_HASH_CACHE
