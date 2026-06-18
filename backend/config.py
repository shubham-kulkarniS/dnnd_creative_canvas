"""Application configuration.

All secrets and tunables are read from environment variables, falling
back to a ``.env`` file in the project root if present. Nothing is
hard-coded. A missing API credential does not crash the server at
import time — callers receive a clean ``RuntimeError`` only when they
actually attempt to invoke a model.

Copy ``.env.example`` to ``.env`` and fill in your values.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
except ImportError:  # python-dotenv is optional at runtime
    pass


def _bool(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    # Auth — Google
    google_api_key: str | None
    use_vertex: bool
    gcp_project: str | None
    gcp_location: str

    # Models — Google
    gemini_image_model: str
    veo_video_model: str

    # Auth + model — Azure OpenAI (optional second image provider).
    azure_api_key: str | None
    azure_endpoint: str | None
    azure_image_deployment: str
    azure_api_version: str

    # Storage
    media_dir: Path

    def assert_configured(self) -> None:
        """Raise if no usable Google credential is present."""
        if self.use_vertex:
            if not self.gcp_project:
                raise RuntimeError(
                    "USE_VERTEX=1 but GOOGLE_CLOUD_PROJECT is not set."
                )
        elif not self.google_api_key:
            raise RuntimeError(
                "GOOGLE_API_KEY is not set (or set USE_VERTEX=1 with a "
                "GCP project). See .env.example."
            )

    def assert_azure_configured(self) -> None:
        """Raise if Azure OpenAI credentials are missing."""
        if not self.azure_api_key or not self.azure_endpoint:
            raise RuntimeError(
                "Azure OpenAI is not configured. Set AZURE_OPENAI_API_KEY and "
                "AZURE_OPENAI_ENDPOINT (and optionally AZURE_OPENAI_IMAGE_DEPLOYMENT)."
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    media_dir = Path(os.environ.get("MEDIA_DIR", "./generated")).resolve()
    media_dir.mkdir(parents=True, exist_ok=True)
    endpoint = (os.environ.get("AZURE_OPENAI_ENDPOINT") or "").rstrip("/") or None
    return Settings(
        google_api_key=os.environ.get("GOOGLE_API_KEY") or None,
        use_vertex=_bool(os.environ.get("USE_VERTEX")),
        gcp_project=os.environ.get("GOOGLE_CLOUD_PROJECT") or None,
        gcp_location=os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1"),
        gemini_image_model=os.environ.get(
            "GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image"
        ),
        veo_video_model=os.environ.get(
            "VEO_VIDEO_MODEL", "veo-3.0-generate-001"
        ),
        azure_api_key=os.environ.get("AZURE_OPENAI_API_KEY") or None,
        azure_endpoint=endpoint,
        azure_image_deployment=os.environ.get(
            "AZURE_OPENAI_IMAGE_DEPLOYMENT", "gpt-image-1"
        ),
        azure_api_version=os.environ.get(
            "AZURE_OPENAI_API_VERSION", "2025-04-01-preview"
        ),
        media_dir=media_dir,
    )
