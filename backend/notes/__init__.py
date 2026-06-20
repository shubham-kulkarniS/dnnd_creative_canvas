"""Notes — director review notes attached to canvas outputs.

Each note carries:
  * free-form ``text`` (the director's comment)
  * a snapshot of the node it was written against (``node_id``,
    ``node_title``, ``node_kind``, ``preview_value``) so the note stays
    meaningful even if the node is deleted or its value mutates
  * optional ``asset_id`` if the user had already saved the output to
    the library at the time of writing

Routes: POST/GET/PATCH/DELETE ``/api/notes``.
"""

from .routes import router

__all__ = ["router"]
