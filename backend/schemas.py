"""Pydantic request/response schemas for the generative-model API."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# Shared enums.
PersonGen = Literal["DONT_ALLOW", "ALLOW_ADULT", "ALLOW_ALL"]
ImageMime = Literal["image/png", "image/jpeg", "image/webp"]
ImageSize = Literal["1K", "2K"]
VideoCompression = Literal["OPTIMIZED", "LOSSLESS"]
VideoResolution = Literal["720p", "1080p"]

ImageAspect = Literal["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"]
VideoAspect = Literal["16:9", "9:16", "1:1"]

# Which backend handles an image request.
#   nanobanana = Gemini 2.5 Flash Image (Google)
#   gpt_image  = Azure OpenAI gpt-image-1
ImageProvider = Literal["nanobanana", "gpt_image"]


class ImageGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    provider: ImageProvider = "nanobanana"
    # Optional reference images (data URL or http URL) — when provided this
    # becomes a multimodal generation rather than pure text-to-image.
    reference_images: list[str] = Field(default_factory=list)
    # Reproducibility & framing.
    seed: Optional[int] = Field(default=None, ge=0, le=2_147_483_647)
    aspect_ratio: Optional[ImageAspect] = None
    image_size: Optional[ImageSize] = None
    # Safety / policy.
    person_generation: Optional[PersonGen] = None
    # Output encoding.
    output_mime_type: Optional[ImageMime] = None
    output_compression_quality: Optional[int] = Field(default=None, ge=1, le=100)
    # Creativity.
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    system_instruction: Optional[str] = Field(default=None, max_length=4000)


class ImageModifyRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    image: str = Field(..., description="data URL, http URL or /media/... path")
    provider: ImageProvider = "nanobanana"
    # Same optional knobs as generate — useful for restyling/inpainting.
    seed: Optional[int] = Field(default=None, ge=0, le=2_147_483_647)
    aspect_ratio: Optional[ImageAspect] = None
    image_size: Optional[ImageSize] = None
    person_generation: Optional[PersonGen] = None
    output_mime_type: Optional[ImageMime] = None
    output_compression_quality: Optional[int] = Field(default=None, ge=1, le=100)
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    system_instruction: Optional[str] = Field(default=None, max_length=4000)


class VideoGenerateRequest(BaseModel):
    mode: Literal["text", "image"] = "text"
    prompt: str = Field(..., min_length=1, max_length=4000)
    image: Optional[str] = Field(
        default=None,
        description="Required when mode='image'. data URL, http URL or /media/... path.",
    )
    duration_seconds: int = Field(default=8, ge=2, le=60)
    aspect_ratio: VideoAspect = "16:9"
    # Veo extras.
    seed: Optional[int] = Field(default=None, ge=0, le=2_147_483_647)
    number_of_videos: int = Field(default=1, ge=1, le=4)
    resolution: Optional[VideoResolution] = None
    fps: Optional[int] = Field(default=None, ge=1, le=60)
    negative_prompt: Optional[str] = Field(default=None, max_length=4000)
    enhance_prompt: Optional[bool] = None
    generate_audio: Optional[bool] = None
    person_generation: Optional[PersonGen] = None
    compression_quality: Optional[VideoCompression] = None


class MediaAsset(BaseModel):
    """Reference to a server-side generated asset."""
    url: str           # public path under /media/...
    mime_type: str
    bytes: int


class ImageResponse(BaseModel):
    asset: MediaAsset
    model: str
    elapsed_ms: int


class VideoResponse(BaseModel):
    asset: MediaAsset
    model: str
    elapsed_ms: int


class CaptionRequest(BaseModel):
    """Image- or video-to-text (description / prompt extraction)."""
    media: str = Field(..., description="data URL, http URL or /media/... path")
    prompt: str = Field(
        default="Describe this in vivid, prompt-style detail.",
        min_length=1,
        max_length=4000,
    )


class CaptionResponse(BaseModel):
    text: str
    model: str
    elapsed_ms: int
