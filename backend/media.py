"""Helpers for resolving user-supplied media references to bytes.

Inputs from the front-end may arrive in three forms:
    1. ``data:<mime>;base64,...``    — small uploads sent inline
    2. ``http(s)://...``             — remote URLs
    3. ``/media/<filename>``         — a prior backend-generated asset

These helpers normalise them into ``(bytes, mime_type)`` and also save
freshly produced media to the on-disk media directory with a stable
public URL.
"""

from __future__ import annotations

import atexit
import base64
import mimetypes
import re
import secrets
import time
from pathlib import Path
from typing import Tuple
from urllib.parse import urlparse

import httpx

from .config import get_settings

_DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;,]+)?(?:;base64)?,(?P<payload>.*)$", re.S)

# Sensible cap to prevent abuse via giant downloads.
MAX_FETCH_BYTES = 25 * 1024 * 1024  # 25 MB

# Reuse one HTTP client so repeated remote media fetches can use connection pooling.
_HTTP_CLIENT = httpx.Client(timeout=30.0, follow_redirects=True)
atexit.register(_HTTP_CLIENT.close)


def load_media(reference: str) -> Tuple[bytes, str]:
    """Resolve a media reference to (bytes, mime_type)."""
    if not reference:
        raise ValueError("Empty media reference")

    if reference.startswith("data:"):
        return _decode_data_url(reference)

    if reference.startswith("/media/"):
        return _read_local(reference)

    parsed = urlparse(reference)
    if parsed.scheme in {"http", "https"}:
        return _fetch_http(reference)

    raise ValueError(f"Unsupported media reference: {reference[:80]}…")


def save_media(data: bytes, mime_type: str, *, prefix: str = "asset") -> Tuple[str, Path]:
    """Persist bytes to the media directory and return (public_url, path)."""
    settings = get_settings()
    ext = mimetypes.guess_extension(mime_type) or ""
    name = f"{prefix}_{int(time.time())}_{secrets.token_hex(4)}{ext}"
    path = settings.media_dir / name
    path.write_bytes(data)
    return f"/media/{name}", path


# ── internal helpers ──────────────────────────────────────────────────


def _decode_data_url(url: str) -> Tuple[bytes, str]:
    match = _DATA_URL_RE.match(url)
    if not match:
        raise ValueError("Malformed data: URL")
    mime = match.group("mime") or "application/octet-stream"
    payload = match.group("payload")
    # The header (everything before the first comma) tells us whether the
    # payload is base64-encoded or URL-encoded.
    header = url.split(",", 1)[0]
    if ";base64" in header:
        data = base64.b64decode(payload)
    else:
        from urllib.parse import unquote_to_bytes
        data = unquote_to_bytes(payload)
    return data, mime


def _read_local(public_url: str) -> Tuple[bytes, str]:
    settings = get_settings()
    name = Path(public_url).name  # strips "/media/" and any traversal
    path = (settings.media_dir / name).resolve()
    # Defence in depth: ensure the resolved path stays inside MEDIA_DIR.
    if settings.media_dir not in path.parents:
        raise ValueError("Refusing to read outside the media directory")
    if not path.is_file():
        raise FileNotFoundError(public_url)
    mime, _ = mimetypes.guess_type(path.name)
    return path.read_bytes(), mime or "application/octet-stream"


def _fetch_http(url: str) -> Tuple[bytes, str]:
    with _HTTP_CLIENT.stream("GET", url) as resp:
        resp.raise_for_status()
        chunks: list[bytes] = []
        total = 0
        for chunk in resp.iter_bytes():
            total += len(chunk)
            if total > MAX_FETCH_BYTES:
                raise ValueError("Remote media exceeds 25 MB limit")
            chunks.append(chunk)
        mime = resp.headers.get("content-type", "application/octet-stream").split(";")[0]
        return b"".join(chunks), mime
