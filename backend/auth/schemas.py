"""Pydantic request / response schemas.

These are the validation boundary between the HTTP edge and the service
layer. Anything that fails validation never reaches business logic.
"""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

# Reasonable defaults that balance UX vs strength. NIST SP 800-63B
# emphasises length over symbol-class complexity, so we require ≥10
# chars and at least one letter + one digit; we deliberately do NOT
# require special characters.
_PASSWORD_MIN_LEN = 10
_PASSWORD_RE_LETTER = re.compile(r"[A-Za-z]")
_PASSWORD_RE_DIGIT  = re.compile(r"\d")


def _validate_password(v: str) -> str:
    if len(v) < _PASSWORD_MIN_LEN:
        raise ValueError(f"password must be at least {_PASSWORD_MIN_LEN} characters")
    if not _PASSWORD_RE_LETTER.search(v):
        raise ValueError("password must contain at least one letter")
    if not _PASSWORD_RE_DIGIT.search(v):
        raise ValueError("password must contain at least one digit")
    return v


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=_PASSWORD_MIN_LEN, max_length=128)
    display_name: str | None = Field(default=None, max_length=120)

    # Pydantic v2 validator — runs after the field-level constraints.
    @field_validator("password")
    @classmethod
    def _check_password(cls, v: str) -> str:
        return _validate_password(v)


class LoginIn(BaseModel):
    email: EmailStr
    # No strength check on login — users may still hold legacy passwords
    # that pre-date a strength policy bump.
    password: str = Field(..., min_length=1, max_length=128)


class UserOut(BaseModel):
    """Public projection — never includes ``password_hash`` or
    ``token_version``."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    display_name: str | None
    is_admin: bool
    created_at: datetime


class UserSummary(BaseModel):
    """Tiny projection used by the share/lookup endpoints. Returns just
    what the UI needs to render a chip; does NOT leak ``created_at`` or
    other history that a non-admin shouldn't see about other users."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    display_name: str | None


class MessageOut(BaseModel):
    detail: str
