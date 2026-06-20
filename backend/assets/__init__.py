"""Assets — session-agnostic library of saved media / text outputs.

Each asset gets a UUID, can be created from a canvas data-node's value
(``POST /api/assets``), listed (``GET /api/assets``), or deleted.
"""

from .routes import router

__all__ = ["router"]
