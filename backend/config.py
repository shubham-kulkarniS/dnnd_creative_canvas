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

    # ── Auth ─────────────────────────────────────────────────────────
    # Where the users table lives. SQLite by default — swap for a real
    # DB URL (e.g. postgresql+psycopg://…) in production.
    auth_db_url: str
    # HMAC key for signing JWTs. NEVER hard-code in source — required
    # via env. A fresh random value invalidates every existing token.
    jwt_secret: str
    jwt_algorithm: str
    # Short-lived access token (limits damage from token theft) +
    # longer-lived refresh token (kept on a tighter cookie path).
    access_token_ttl_minutes: int
    refresh_token_ttl_days: int
    # Cookie flags. Secure=True requires HTTPS — set to False in local
    # dev only (over plain HTTP). SameSite=strict blocks CSRF from
    # cross-site contexts.
    auth_cookie_secure: bool
    auth_cookie_samesite: str  # "strict" | "lax" | "none"
    auth_cookie_domain: str | None

    # ── Runtime ──────────────────────────────────────────────────────
    # "dev" disables HTTP caching for /static so JS/CSS edits show up
    # without a hard refresh. "prod" lets the browser cache static
    # assets and uses ETag/304 for revalidation.
    env: str  # "dev" | "prod"

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

    def assert_auth_configured(self) -> None:
        """Raise if auth secrets are missing — prevents booting an
        insecure server with the (random) fallback JWT secret."""
        if not self.jwt_secret or len(self.jwt_secret) < 32:
            raise RuntimeError(
                "AUTH_JWT_SECRET must be set to a value of at least 32 "
                "characters. Generate one with `python -c \"import secrets; "
                "print(secrets.token_urlsafe(48))\"`."
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
        # Auth — see Settings for documentation on each field.
        auth_db_url=os.environ.get(
            "AUTH_DB_URL", f"sqlite:///{(Path('./data/auth.db')).resolve()}"
        ),
        jwt_secret=os.environ.get("AUTH_JWT_SECRET", ""),
        jwt_algorithm=os.environ.get("AUTH_JWT_ALGORITHM", "HS256"),
        access_token_ttl_minutes=int(
            os.environ.get("AUTH_ACCESS_TTL_MINUTES", "15")
        ),
        refresh_token_ttl_days=int(
            os.environ.get("AUTH_REFRESH_TTL_DAYS", "7")
        ),
        auth_cookie_secure=_bool(os.environ.get("AUTH_COOKIE_SECURE", "1")),
        auth_cookie_samesite=os.environ.get("AUTH_COOKIE_SAMESITE", "strict").lower(),
        auth_cookie_domain=os.environ.get("AUTH_COOKIE_DOMAIN") or None,
        env=(os.environ.get("APP_ENV", "dev").strip().lower()
             if os.environ.get("APP_ENV", "dev").strip().lower() in {"dev", "prod"}
             else "dev"),
    )
