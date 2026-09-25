"""Create the FastAPI application and manage shared resources."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from .api import router
from .downloads import DownloadService
from .upbit import UpbitClient

from .results import router as results_router
from .strategies import router as strategies_router

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
RESULT_DIR = PROJECT_ROOT / "result"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize services and close them during shutdown."""
    DATA_DIR.mkdir(exist_ok=True)
    RESULT_DIR.mkdir(exist_ok=True)

    client = UpbitClient()
    service = DownloadService(client, DATA_DIR)
    app.state.downloads = service

    try:
        yield
    finally:
        await service.close()
        await client.close()


app = FastAPI(title="lrtz", lifespan=lifespan)
app.include_router(router)
app.include_router(results_router)
app.include_router(strategies_router)