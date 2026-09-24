"""Expose market data and download operations through HTTP."""

from pathlib import Path
from typing import Annotated, cast

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from .downloads import DownloadService
from .models import DownloadRequest, DownloadStatus, Market

router = APIRouter(prefix="/api")


def get_service(request: Request) -> DownloadService:
    """Retrieve the application-owned download service."""
    return cast(DownloadService, request.app.state.downloads)


Service = Annotated[DownloadService, Depends(get_service)]


@router.get("/markets", response_model=list[Market])
async def markets(service: Service) -> list[Market]:
    """Return the available Upbit trading pairs."""
    try:
        return await service.client.markets()
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail="Could not load the Upbit market list.",
        ) from error


@router.post(
    "/download",
    response_model=DownloadStatus,
    status_code=202,
)
async def start_download(
    payload: DownloadRequest,
    service: Service,
) -> DownloadStatus:
    """Start a new download when the service is idle."""
    try:
        return service.start(payload)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error


@router.get("/status", response_model=DownloadStatus)
async def status(service: Service) -> DownloadStatus:
    """Return the current download state."""
    return service.status


@router.get("/files/{filename}")
async def download_file(filename: str, service: Service) -> FileResponse:
    """Serve a generated CSV from the configured data directory."""
    if Path(filename).name != filename or not filename.endswith(".csv"):
        raise HTTPException(400, "Invalid filename.")

    path = (service.data_dir / filename).resolve()

    if path.parent != service.data_dir.resolve():
        raise HTTPException(400, "Invalid file path.")
    if not path.is_file():
        raise HTTPException(404, "File not found.")

    return FileResponse(
        path,
        media_type="text/csv",
        filename=filename,
    )