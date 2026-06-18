"""Gemini 2.5 Flash Image (a.k.a. "Nano Banana") subroutines.

This module exposes two pure functions:

  * :func:`generate_image` — text-to-image (with optional reference images)
  * :func:`modify_image`   — image edit / restyle driven by a prompt
  * :func:`caption_media`  — image/video understanding → text

Both image functions accept the same optional ``ImageConfig`` knobs.
"""

from __future__ import annotations

import logging
from typing import Iterable, Tuple

from ..config import get_settings
from ..media import load_media
from . import get_client

log = logging.getLogger(__name__)


def generate_image(
    prompt: str,
    references: Iterable[str] = (),
    *,
    seed: int | None = None,
    aspect_ratio: str | None = None,
    image_size: str | None = None,
    person_generation: str | None = None,
    output_mime_type: str | None = None,
    output_compression_quality: int | None = None,
    temperature: float | None = None,
    system_instruction: str | None = None,
) -> Tuple[bytes, str]:
    """Generate an image from a prompt (and optional reference images)."""
    if not prompt or not prompt.strip():
        raise ValueError("prompt is required")

    client = get_client()
    model = get_settings().gemini_image_model

    parts: list = [prompt]
    for ref in references:
        data, mime = load_media(ref)
        parts.append(_inline_part(data, mime))

    config = _build_image_config(
        seed=seed,
        aspect_ratio=aspect_ratio,
        image_size=image_size,
        person_generation=person_generation,
        output_mime_type=output_mime_type,
        output_compression_quality=output_compression_quality,
        temperature=temperature,
        system_instruction=system_instruction,
    )
    log.info("nano-banana generate: model=%s prompt_len=%d refs=%d seed=%s ar=%s",
             model, len(prompt), len(parts) - 1, seed, aspect_ratio)
    response = client.models.generate_content(
        model=model, contents=parts, config=config,
    )
    return _extract_image(response)


def modify_image(
    prompt: str,
    image_ref: str,
    *,
    seed: int | None = None,
    aspect_ratio: str | None = None,
    image_size: str | None = None,
    person_generation: str | None = None,
    output_mime_type: str | None = None,
    output_compression_quality: int | None = None,
    temperature: float | None = None,
    system_instruction: str | None = None,
) -> Tuple[bytes, str]:
    """Edit/restyle ``image_ref`` according to ``prompt``."""
    if not prompt or not prompt.strip():
        raise ValueError("prompt is required")
    if not image_ref:
        raise ValueError("image is required")

    client = get_client()
    model = get_settings().gemini_image_model
    data, mime = load_media(image_ref)

    contents = [prompt, _inline_part(data, mime)]
    config = _build_image_config(
        seed=seed,
        aspect_ratio=aspect_ratio,
        image_size=image_size,
        person_generation=person_generation,
        output_mime_type=output_mime_type,
        output_compression_quality=output_compression_quality,
        temperature=temperature,
        system_instruction=system_instruction,
    )
    log.info("nano-banana modify: model=%s prompt_len=%d input_mime=%s",
             model, len(prompt), mime)
    response = client.models.generate_content(
        model=model, contents=contents, config=config,
    )
    return _extract_image(response)


def caption_media(prompt: str, media_ref: str) -> str:
    """Describe an image or video as text using Gemini (image-/video-to-prompt)."""
    if not media_ref:
        raise ValueError("media is required")

    client = get_client()
    # Image-capable Gemini handles both image and video understanding.
    model = get_settings().gemini_image_model
    data, mime = load_media(media_ref)

    contents = [prompt, _inline_part(data, mime)]
    log.info("gemini caption: model=%s prompt_len=%d input_mime=%s",
             model, len(prompt), mime)
    response = client.models.generate_content(model=model, contents=contents)
    return _extract_text(response)


# ── internal helpers ──────────────────────────────────────────────────


def _inline_part(data: bytes, mime: str):
    """Wrap raw bytes in the SDK's ``Part`` structure for inline content."""
    from google.genai import types
    return types.Part.from_bytes(data=data, mime_type=mime)


def _build_image_config(
    *,
    seed: int | None,
    aspect_ratio: str | None,
    image_size: str | None = None,
    person_generation: str | None = None,
    output_mime_type: str | None = None,
    output_compression_quality: int | None = None,
    temperature: float | None = None,
    system_instruction: str | None = None,
):
    """Assemble a ``GenerateContentConfig`` only when at least one optional
    setting was supplied. Returning ``None`` lets the SDK use defaults."""
    image_kwargs: dict = {}
    if aspect_ratio:                       image_kwargs["aspect_ratio"] = aspect_ratio
    if image_size:                         image_kwargs["image_size"] = image_size
    if person_generation:                  image_kwargs["person_generation"] = person_generation
    if output_mime_type:                   image_kwargs["output_mime_type"] = output_mime_type
    if output_compression_quality is not None:
        image_kwargs["output_compression_quality"] = output_compression_quality

    top_kwargs: dict = {}
    if seed is not None:                   top_kwargs["seed"] = seed
    if temperature is not None:            top_kwargs["temperature"] = temperature
    if system_instruction:                 top_kwargs["system_instruction"] = system_instruction

    if not image_kwargs and not top_kwargs:
        return None

    from google.genai import types
    if image_kwargs:
        top_kwargs["image_config"] = types.ImageConfig(**image_kwargs)
    return types.GenerateContentConfig(**top_kwargs)


def _extract_image(response) -> Tuple[bytes, str]:
    """Pull the first inline image from a ``generate_content`` response."""
    for candidate in getattr(response, "candidates", []) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", []) or []:
            inline = getattr(part, "inline_data", None)
            if inline and getattr(inline, "data", None):
                mime = getattr(inline, "mime_type", None) or "image/png"
                return inline.data, mime
    raise RuntimeError(
        "No image returned by the model — the prompt may have been refused."
    )


def _extract_text(response) -> str:
    """Pull the concatenated text content from a ``generate_content`` response."""
    text = getattr(response, "text", None)
    if text:
        return text.strip()
    chunks: list[str] = []
    for candidate in getattr(response, "candidates", []) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", []) or []:
            t = getattr(part, "text", None)
            if t:
                chunks.append(t)
    if not chunks:
        raise RuntimeError(
            "No text returned by the model — the prompt may have been refused."
        )
    return "".join(chunks).strip()
