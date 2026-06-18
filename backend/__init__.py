"""Backend package for the Infinite Canvas UI.

Exposes the FastAPI router and generative-model service layer.
"""

from .routes import router

__all__ = ["router"]
