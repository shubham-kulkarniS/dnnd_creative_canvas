"""Backend package for the Infinite Canvas UI.

Exposes the FastAPI routers and generative-model service layer.
"""

from .admin import router as admin_router
from .admin.routes import users_router
from .assets import router as assets_router
from .auth import router as auth_router
from .notes import router as notes_router
from .routes import router
from .sessions import router as sessions_router

__all__ = [
    "router",
    "auth_router",
    "admin_router",
    "users_router",
    "assets_router",
    "notes_router",
    "sessions_router",
]
