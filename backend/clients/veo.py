"""Veo video-generation subroutines.

Supports two modes:
  * ``text``  — text-to-video
  * ``image`` — image-to-video (requires an input image)

Veo runs as a long-running operation, so we poll the operation handle
until it completes, then download the resulting MP4 bytes.
"""

from __future__ import annotations

import logging
import random
import time
from typing import Tuple

from ..config import get_settings
from ..media import load_media
from . import get_client

log = logging.getLogger(__name__)

MAX_POLL_SECONDS = 10 * 60  # 10 minutes
POLL_MIN_SECONDS = 1.0
POLL_MAX_SECONDS = 10.0
POLL_JITTER_SECONDS = 0.3


def generate_video(
    *,
    prompt: str,
    image_ref: str | None = None,
    duration_seconds: int = 8,
    aspect_ratio: str = "16:9",
    seed: int | None = None,
    number_of_videos: int = 1,
    resolution: str | None = None,
    fps: int | None = None,
    negative_prompt: str | None = None,
    enhance_prompt: bool | None = None,
    generate_audio: bool | None = None,
    person_generation: str | None = None,
    compression_quality: str | None = None,
) -> Tuple[bytes, str]:
    """Generate a video; returns ``(bytes, mime_type)``.

    ``image_ref`` makes this image-to-video, otherwise text-to-video.
    Optional kwargs map directly onto Veo's ``GenerateVideosConfig``
    fields; ``None`` lets the model decide.
    """
    if not prompt or not prompt.strip():
        raise ValueError("prompt is required")

    client = get_client()
    model = get_settings().veo_video_model

    from google.genai import types

    cfg_kwargs: dict = {
        "aspect_ratio":     aspect_ratio,
        "duration_seconds": int(duration_seconds),
        "number_of_videos": int(number_of_videos),
    }
    if seed is not None:                cfg_kwargs["seed"] = seed
    if resolution:                      cfg_kwargs["resolution"] = resolution
    if fps is not None:                 cfg_kwargs["fps"] = fps
    if negative_prompt:                 cfg_kwargs["negative_prompt"] = negative_prompt
    if enhance_prompt is not None:      cfg_kwargs["enhance_prompt"] = enhance_prompt
    if generate_audio is not None:      cfg_kwargs["generate_audio"] = generate_audio
    if person_generation:               cfg_kwargs["person_generation"] = person_generation
    if compression_quality:             cfg_kwargs["compression_quality"] = compression_quality

    config = types.GenerateVideosConfig(**cfg_kwargs)

    kwargs: dict = {"model": model, "prompt": prompt, "config": config}
    if image_ref:
        data, mime = load_media(image_ref)
        kwargs["image"] = types.Image(image_bytes=data, mime_type=mime)
        mode = "image"
    else:
        mode = "text"

    log.info("veo generate (%s): model=%s prompt_len=%d cfg=%s",
             mode, model, len(prompt), {k: v for k, v in cfg_kwargs.items() if v is not None})
    operation = client.models.generate_videos(**kwargs)
    operation = _await_operation(client, operation)

    video_bytes, mime_type = _download_first_video(client, operation)
    return video_bytes, mime_type


# ── internal helpers ──────────────────────────────────────────────────


def _await_operation(client, operation):
    """Poll until the long-running video op resolves."""
    started = time.monotonic()
    delay = POLL_MIN_SECONDS
    while not getattr(operation, "done", False):
        if time.monotonic() - started > MAX_POLL_SECONDS:
            raise TimeoutError("Veo job did not complete within the timeout window")
        sleep_for = delay + random.uniform(0.0, POLL_JITTER_SECONDS)
        time.sleep(sleep_for)
        operation = client.operations.get(operation)
        delay = min(POLL_MAX_SECONDS, delay * 2.0)
    if getattr(operation, "error", None):
        raise RuntimeError(f"Veo job failed: {operation.error}")
    return operation


def _download_first_video(client, operation) -> Tuple[bytes, str]:
    response = getattr(operation, "response", None) or getattr(operation, "result", None)
    generated = getattr(response, "generated_videos", None) if response else None
    if not generated:
        raise RuntimeError("Veo returned no videos")

    video_obj = generated[0].video
    # The SDK lazily downloads; some versions return bytes inline, others
    # expose a `uri`. Handle both transparently.
    if getattr(video_obj, "video_bytes", None):
        return video_obj.video_bytes, "video/mp4"

    try:
        # download() mutates the object, attaching .video_bytes
        client.files.download(file=video_obj)
        if getattr(video_obj, "video_bytes", None):
            return video_obj.video_bytes, "video/mp4"
    except Exception:  # pragma: no cover — fall through to direct fetch
        pass

    uri = getattr(video_obj, "uri", None)
    if uri:
        import httpx
        with httpx.Client(timeout=120.0, follow_redirects=True) as http:
            r = http.get(uri)
            r.raise_for_status()
            return r.content, r.headers.get("content-type", "video/mp4")

    raise RuntimeError("Veo response contained no downloadable video bytes")
