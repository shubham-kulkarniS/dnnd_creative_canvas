"""Azure OpenAI ``gpt-image-1`` image generation + editing.

Mirrors the surface of ``backend.clients.gemini`` so the service layer
can dispatch between providers transparently. Only image features are
implemented — Azure OpenAI is not used for video or captioning.

Environment:
    AZURE_OPENAI_API_KEY
    AZURE_OPENAI_ENDPOINT           https://<resource>.openai.azure.com
    AZURE_OPENAI_IMAGE_DEPLOYMENT   defaults to "gpt-image-1"
    AZURE_OPENAI_API_VERSION        defaults to "2025-04-01-preview"

gpt-image-1 size constraints (as of mid-2026):
    "1024x1024", "1536x1024", "1024x1536", "auto".

The Gemini UI exposes 8 aspect ratios; we collapse them to the three
supported sizes by picking the closest match.
"""

from __future__ import annotations

import base64
import io
import logging
from functools import lru_cache
from typing import Iterable, Optional, Tuple

from ..config import get_settings
from ..media import load_media

log = logging.getLogger(__name__)


# Map the 8 Gemini aspect ratios to the closest gpt-image-1 canvas.
_ASPECT_TO_SIZE = {
    "1:1":  "1024x1024",
    "16:9": "1536x1024",
    "21:9": "1536x1024",
    "3:2":  "1536x1024",
    "4:3":  "1536x1024",
    "9:16": "1024x1536",
    "2:3":  "1024x1536",
    "3:4":  "1024x1536",
}


@lru_cache(maxsize=1)
def _client():
    from openai import AzureOpenAI
    s = get_settings()
    s.assert_azure_configured()
    return AzureOpenAI(
        api_key=s.azure_api_key,
        azure_endpoint=s.azure_endpoint,
        api_version=s.azure_api_version,
    )


def _aspect_to_size(aspect: Optional[str]) -> Optional[str]:
    if not aspect:
        return None
    return _ASPECT_TO_SIZE.get(aspect, "auto")


def _fmt_from_mime(mime: Optional[str]) -> Optional[str]:
    if not mime:
        return None
    fmt = mime.split("/")[-1].lower()
    return fmt if fmt in ("png", "jpeg", "webp") else None


def _common_kwargs(
    *,
    aspect_ratio: Optional[str],
    output_mime_type: Optional[str],
    output_compression_quality: Optional[int],
) -> dict:
    kw: dict = {}
    size = _aspect_to_size(aspect_ratio)
    if size:
        kw["size"] = size
    fmt = _fmt_from_mime(output_mime_type)
    if fmt:
        kw["output_format"] = fmt
    if (
        output_compression_quality is not None
        and fmt in ("jpeg", "webp")
    ):
        kw["output_compression"] = int(output_compression_quality)
    return kw


def generate_image(
    prompt: str,
    references: Iterable[str] = (),
    *,
    seed: Optional[int] = None,                    # not supported by gpt-image-1
    aspect_ratio: Optional[str] = None,
    image_size: Optional[str] = None,              # ignored
    person_generation: Optional[str] = None,       # ignored
    output_mime_type: Optional[str] = None,
    output_compression_quality: Optional[int] = None,
    temperature: Optional[float] = None,           # ignored
    system_instruction: Optional[str] = None,      # ignored
) -> Tuple[bytes, str]:
    """Generate an image via Azure OpenAI ``gpt-image-1``.

    Reference images route through the edit endpoint; gpt-image-1 does
    not accept reference images on the bare generate call.
    """
    if not prompt or not prompt.strip():
        raise ValueError("prompt is required")
    refs = [r for r in (references or []) if r]
    if refs:
        return modify_image(
            prompt,
            refs[0],
            aspect_ratio=aspect_ratio,
            output_mime_type=output_mime_type,
            output_compression_quality=output_compression_quality,
        )

    client = _client()
    s = get_settings()
    kwargs = {
        "prompt": prompt,
        "model": s.azure_image_deployment,
        "n": 1,
        **_common_kwargs(
            aspect_ratio=aspect_ratio,
            output_mime_type=output_mime_type,
            output_compression_quality=output_compression_quality,
        ),
    }
    log.info(
        "gpt-image generate: deployment=%s size=%s fmt=%s",
        s.azure_image_deployment, kwargs.get("size"), kwargs.get("output_format"),
    )
    resp = client.images.generate(**kwargs)
    return _extract(resp, fallback_fmt=kwargs.get("output_format", "png"))


def modify_image(
    prompt: str,
    image_ref: str,
    *,
    seed: Optional[int] = None,
    aspect_ratio: Optional[str] = None,
    image_size: Optional[str] = None,
    person_generation: Optional[str] = None,
    output_mime_type: Optional[str] = None,
    output_compression_quality: Optional[int] = None,
    temperature: Optional[float] = None,
    system_instruction: Optional[str] = None,
) -> Tuple[bytes, str]:
    """Edit ``image_ref`` via the gpt-image-1 edits endpoint."""
    if not prompt or not prompt.strip():
        raise ValueError("prompt is required")
    if not image_ref:
        raise ValueError("image is required")

    client = _client()
    s = get_settings()
    data, mime = load_media(image_ref)
    # SDK accepts a (filename, fileobj, mime) tuple for file uploads.
    ext = (mime.split("/")[-1] or "png").lower()
    if ext == "jpeg":
        ext = "jpg"
    file_tuple = (f"input.{ext}", io.BytesIO(data), mime)

    kwargs = {
        "prompt": prompt,
        "model": s.azure_image_deployment,
        "image": file_tuple,
        "n": 1,
        **_common_kwargs(
            aspect_ratio=aspect_ratio,
            output_mime_type=output_mime_type,
            output_compression_quality=output_compression_quality,
        ),
    }
    log.info(
        "gpt-image edit: deployment=%s size=%s fmt=%s input_mime=%s",
        s.azure_image_deployment, kwargs.get("size"), kwargs.get("output_format"), mime,
    )
    resp = client.images.edit(**kwargs)
    return _extract(resp, fallback_fmt=kwargs.get("output_format", "png"))


# ── internal helpers ──────────────────────────────────────────────────


def _extract(resp, *, fallback_fmt: str) -> Tuple[bytes, str]:
    """Pull bytes + mime out of an ``ImagesResponse``."""
    items = getattr(resp, "data", None) or []
    if not items:
        raise RuntimeError("No image returned by gpt-image-1.")
    item = items[0]
    b64 = getattr(item, "b64_json", None)
    if b64:
        return base64.b64decode(b64), f"image/{fallback_fmt}"
    url = getattr(item, "url", None)
    if url:
        # Defensive — gpt-image-1 normally returns base64, but dall-e
        # deployments return a URL. Fetch it.
        import urllib.request
        with urllib.request.urlopen(url, timeout=30) as r:  # noqa: S310
            return r.read(), f"image/{fallback_fmt}"
    raise RuntimeError("gpt-image-1 response contained no image data or URL.")
