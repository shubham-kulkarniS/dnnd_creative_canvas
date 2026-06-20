"""GenAI Nuke Studio — FastAPI host for the infinite-canvas web UI.

Hosts:
  * the static SPA under ``/static`` (and ``/`` for the entry point)
  * generated/uploaded media under ``/media``
  * the generative-model JSON API under ``/api/*`` (see :mod:`backend.routes`)
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from backend import (
    admin_router,
    assets_router,
    auth_router,
    notes_router,
    router as api_router,
    sessions_router,
    users_router,
)
from backend.auth.db import init_db as init_auth_db
from backend.config import get_settings
from backend.library_db import init_db as init_library_db
# Import the ORM modules so their tables are registered on LibraryBase
# before init_library_db() runs DDL.
from backend.assets   import models as _assets_models   # noqa: F401
from backend.notes    import models as _notes_models    # noqa: F401
from backend.sessions import models as _session_models  # noqa: F401


class NoCacheStaticFiles(StaticFiles):
    """StaticFiles variant that disables browser caching.

    Useful during development so edits to JS/CSS show up without a hard
    refresh. Production uses ``CachedStaticFiles`` (below).
    """

    async def get_response(self, path: str, scope: Scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


class CachedStaticFiles(StaticFiles):
    """Production StaticFiles: lets the browser cache aggressively but
    still revalidates via ETag.

    Starlette already emits an ``ETag`` and handles ``If-None-Match``
    (returning 304), so a 5-minute ``max-age`` is safe: hot reloads
    avoid even sending the conditional GET, while cache busts on
    deploy by ``rev=<sha>`` in the URL still work.

    For a true zero-revalidation policy ship hashed filenames or pin
    the source URL with ``?v=<rev>`` and bump that on deploy.
    """

    async def get_response(self, path: str, scope: Scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        # 5 minutes hot cache + ETag revalidation thereafter.
        response.headers.setdefault(
            "Cache-Control",
            "public, max-age=300, must-revalidate",
        )
        return response


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = STATIC_DIR / "index.html"
# Optional production bundle produced by ``npm run build``. When this
# file exists AND ``APP_ENV=prod``, the SPA shell will swap its
# <script type="module" src="/static/js/main.js"> tag to point at
# this single minified file, collapsing ~25 module fetches into one.
BUNDLE_FILE = STATIC_DIR / "dist" / "app.js"


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Fail fast if auth isn't configured — refuses to boot with an
    # insecure (empty) JWT secret. Then create both schemas.
    get_settings().assert_auth_configured()
    init_auth_db()
    init_library_db()
    # Warm slow ML-client imports so the first generation request
    # doesn't pay ~300-700 ms of cold-import latency. These modules
    # are normally imported lazily by the service layer; pulling them
    # in here moves that cost to startup.
    from backend.clients import azure_openai as _aoai   # noqa: F401
    from backend.clients import gemini as _gemini       # noqa: F401
    from backend.clients import veo as _veo             # noqa: F401
    yield


app = FastAPI(title="Greenhouse canvas", lifespan=lifespan)
# Static-file caching policy is environment-driven so dev iteration
# stays instant while prod gets long-lived browser caches + ETag
# revalidation. See ``CachedStaticFiles`` for the prod recipe.
_static_cls = CachedStaticFiles if get_settings().env == "prod" else NoCacheStaticFiles
app.mount("/static", _static_cls(directory=STATIC_DIR), name="static")
app.mount("/media", StaticFiles(directory=get_settings().media_dir), name="media")
app.include_router(api_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(users_router)
app.include_router(assets_router)
app.include_router(notes_router)
app.include_router(sessions_router)


@app.get("/", include_in_schema=False, response_model=None)
async def index() -> FileResponse | HTMLResponse:
    """Serve the single-page application shell.

    The index always carries fresh module URLs (it's the only thing
    that names other static files), so we don't want it stuck in
    the browser cache after a deploy. ``no-store`` in prod is fine
    because /static/* already does aggressive caching.

    In production, if ``static/dist/app.js`` exists (built via
    ``npm run build``), we rewrite the SPA entry tag so the browser
    fetches the single minified bundle instead of ~25 ES modules.
    """
    if get_settings().env == "prod" and BUNDLE_FILE.is_file():
        html = INDEX_FILE.read_text(encoding="utf-8").replace(
            '<script type="module" src="/static/js/main.js"></script>',
            '<script type="module" src="/static/dist/app.js"></script>',
            1,
        )
        return HTMLResponse(
            content=html,
            headers={"Cache-Control": "no-store, must-revalidate"},
        )
    return FileResponse(
        INDEX_FILE,
        headers={"Cache-Control": "no-store, must-revalidate"},
    )


@app.get("/health", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
