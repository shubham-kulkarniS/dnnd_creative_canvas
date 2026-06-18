"""GenAI Nuke Studio — FastAPI host for the infinite-canvas web UI.

Hosts:
  * the static SPA under ``/static`` (and ``/`` for the entry point)
  * generated/uploaded media under ``/media``
  * the generative-model JSON API under ``/api/*`` (see :mod:`backend.routes`)
"""

from __future__ import annotations

from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from backend import router as api_router
from backend.config import get_settings


class NoCacheStaticFiles(StaticFiles):
    """StaticFiles variant that disables browser caching.

    Useful during development so edits to JS/CSS show up without a hard
    refresh. Swap back to ``StaticFiles`` for production.
    """

    async def get_response(self, path: str, scope: Scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = STATIC_DIR / "index.html"

app = FastAPI(title="Greenhouse canvas")
app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")
app.mount("/media", StaticFiles(directory=get_settings().media_dir), name="media")
app.include_router(api_router)


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    """Serve the single-page application shell."""
    return FileResponse(
        INDEX_FILE,
        headers={"Cache-Control": "no-store, must-revalidate"},
    )


@app.get("/health", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
