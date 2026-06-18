"""FastAPI router exposing the generative-model endpoints.

The router stays lean: parse → delegate to ``service`` → return. All
heavy work runs on a thread-pool so the event loop is not blocked by
the blocking ``google-genai`` SDK calls.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from . import service
from .schemas import (
    CaptionRequest,
    CaptionResponse,
    ImageGenerateRequest,
    ImageModifyRequest,
    ImageResponse,
    VideoGenerateRequest,
    VideoResponse,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["generative"])


@router.post("/generate/image", response_model=ImageResponse)
async def generate_image(req: ImageGenerateRequest) -> ImageResponse:
    try:
        return await run_in_threadpool(service.run_generate_image, req)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        log.exception("generate_image failed")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/modify/image", response_model=ImageResponse)
async def modify_image(req: ImageModifyRequest) -> ImageResponse:
    try:
        return await run_in_threadpool(service.run_modify_image, req)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        log.exception("modify_image failed")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/generate/video", response_model=VideoResponse)
async def generate_video(req: VideoGenerateRequest) -> VideoResponse:
    try:
        return await run_in_threadpool(service.run_generate_video, req)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except RuntimeError as e:
        log.exception("generate_video failed")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/caption", response_model=CaptionResponse)
async def caption(req: CaptionRequest) -> CaptionResponse:
    """Caption an image or video — used for image2prompt and video2prompt."""
    try:
        return await run_in_threadpool(service.run_caption, req)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except RuntimeError as e:
        log.exception("caption failed")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/config/status")
async def config_status() -> dict:
    """Lightweight probe so the UI can tell the user 'configure your API key'."""
    from .config import get_settings

    s = get_settings()
    google_ok = bool(s.google_api_key or (s.use_vertex and s.gcp_project))
    return {
        "configured": google_ok,
        "mode": "vertex" if s.use_vertex else "api_key",
        "image_model": s.gemini_image_model,
        "video_model": s.veo_video_model,
        "providers": {
            "nanobanana": {
                "available": google_ok,
                "model": s.gemini_image_model,
            },
            "gpt_image": {
                "available": bool(s.azure_api_key and s.azure_endpoint),
                "model": s.azure_image_deployment,
            },
            "veo": {
                "available": google_ok,
                "model": s.veo_video_model,
            },
            # Placeholders for video providers not yet implemented in the
            # backend — surfaced so the UI can show them as "not configured".
            "gpt_video": {"available": False, "model": None},
            "ltx":       {"available": False, "model": None},
        },
    }
