"""User identification layer.

Architecture (Controller → Service → Repository):

* ``routes``        — FastAPI controllers (thin: parse, delegate, set cookies)
* ``service``       — business rules (hash on signup, verify on login, issue
                       tokens, revoke). Pure Python, no FastAPI imports.
* ``repository``    — SQLAlchemy persistence boundary (no business rules)
* ``security``      — argon2 password hashing + JWT encode/decode
* ``dependencies``  — ``get_current_user`` (the ``isAuthenticated`` guard)
* ``models``        — SQLAlchemy ORM model
* ``schemas``       — Pydantic request/response validation
* ``db``            — engine / SessionLocal / init_db
"""

from .routes import router

__all__ = ["router"]
