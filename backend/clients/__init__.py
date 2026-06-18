"""Lazy, cached factory for the ``google-genai`` SDK client.

Supports both the Gemini API (API-key auth) and Vertex AI (GCP project
+ ADC). Both share the same ``google.genai.Client`` interface, so the
rest of the backend is unaware of which mode is active.
"""

from __future__ import annotations

from functools import lru_cache

from ..config import get_settings


@lru_cache(maxsize=1)
def get_client():
    """Return a configured ``google.genai.Client`` (cached for reuse)."""
    settings = get_settings()
    settings.assert_configured()

    try:
        from google import genai
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "google-genai is not installed. Add it via `pip install -r requirements.txt`."
        ) from exc

    if settings.use_vertex:
        return genai.Client(
            vertexai=True,
            project=settings.gcp_project,
            location=settings.gcp_location,
        )
    return genai.Client(api_key=settings.google_api_key)
