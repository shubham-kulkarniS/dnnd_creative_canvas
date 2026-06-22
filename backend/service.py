"""High-level service operations that the HTTP routes delegate to.

Kept thin so the same primitives can be reused by a CLI or batch job
without depending on FastAPI.
"""

from __future__ import annotations

import logging
import time
from typing import Iterable

from .clients import gemini, veo
from .clients import azure_openai
from .config import get_settings
from .media import save_media
from .schemas import (
    CaptionRequest,
    CaptionResponse,
    ImageGenerateRequest,
    ImageModifyRequest,
    ImageResponse,
    MediaAsset,
    VideoGenerateRequest,
    VideoResponse,
)

log = logging.getLogger(__name__)


def _asset(public_url: str, mime: str, data: bytes) -> MediaAsset:
    return MediaAsset(url=public_url, mime_type=mime, bytes=len(data))


def _image_client(provider: str):
    """Return (module, model_label) for the requested image provider."""
    s = get_settings()
    if provider == "gpt_image":
        return azure_openai, s.azure_image_deployment
    return gemini, s.gemini_image_model


def run_generate_image(req: ImageGenerateRequest) -> ImageResponse:
    t0 = time.monotonic()
    client, model_label = _image_client(req.provider)
    data, mime = client.generate_image(
        req.prompt,
        req.reference_images,
        seed=req.seed,
        aspect_ratio=req.aspect_ratio,
        image_size=req.image_size,
        person_generation=req.person_generation,
        output_mime_type=req.output_mime_type,
        output_compression_quality=req.output_compression_quality,
        temperature=req.temperature,
        system_instruction=req.system_instruction,
    )
    url, _ = save_media(data, mime, prefix="gen_img")
    return ImageResponse(
        asset=_asset(url, mime, data),
        model=model_label,
        elapsed_ms=int((time.monotonic() - t0) * 1000),
    )


def run_modify_image(req: ImageModifyRequest) -> ImageResponse:
    t0 = time.monotonic()
    client, model_label = _image_client(req.provider)
    data, mime = client.modify_image(
        req.prompt,
        req.image,
        seed=req.seed,
        aspect_ratio=req.aspect_ratio,
        image_size=req.image_size,
        person_generation=req.person_generation,
        output_mime_type=req.output_mime_type,
        output_compression_quality=req.output_compression_quality,
        temperature=req.temperature,
        system_instruction=req.system_instruction,
    )
    url, _ = save_media(data, mime, prefix="mod_img")
    return ImageResponse(
        asset=_asset(url, mime, data),
        model=model_label,
        elapsed_ms=int((time.monotonic() - t0) * 1000),
    )


def run_generate_video(req: VideoGenerateRequest) -> VideoResponse:
    if req.mode == "image" and not req.image:
        raise ValueError("image is required when mode='image'")
    t0 = time.monotonic()
    video_list = veo.generate_video(
        prompt=req.prompt,
        image_ref=req.image if req.mode == "image" else None,
        duration_seconds=req.duration_seconds,
        aspect_ratio=req.aspect_ratio,
        seed=req.seed,
        number_of_videos=req.number_of_videos,
        resolution=req.resolution,
        fps=req.fps,
        negative_prompt=req.negative_prompt,
        enhance_prompt=req.enhance_prompt,
        generate_audio=req.generate_audio,
        person_generation=req.person_generation,
        compression_quality=req.compression_quality,
    )
    assets = []
    for data, mime in video_list:
        url, _ = save_media(data, mime, prefix="gen_vid")
        assets.append(_asset(url, mime, data))
    return VideoResponse(
        assets=assets,
        model=get_settings().veo_video_model,
        elapsed_ms=int((time.monotonic() - t0) * 1000),
    )


def run_caption(req: CaptionRequest) -> CaptionResponse:
    t0 = time.monotonic()
    text = gemini.caption_media(req.prompt, req.media)
    return CaptionResponse(
        text=text,
        model=get_settings().gemini_image_model,
        elapsed_ms=int((time.monotonic() - t0) * 1000),
    )
