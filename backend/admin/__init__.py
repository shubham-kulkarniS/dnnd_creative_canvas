"""Admin — usage dashboard + user directory.

Routes here are gated by ``require_admin``. They are *thin*: they
query the existing repositories rather than introduce a new persistence
layer of their own.
"""
from .routes import router

__all__ = ["router"]
