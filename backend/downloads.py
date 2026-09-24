"""Coordinate downloads independently of HTTP routing."""

import asyncio
import calendar
import logging
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from .candles import KST, aggregate_two_hours, write_csv
from .models import Candle, DownloadRequest, DownloadStatus
from .upbit import UpbitClient

LOGGER = logging.getLogger(__name__)


def resolve_range(request: DownloadRequest) -> tuple[datetime, datetime]:
    """Resolve a requested period into an inclusive UTC time window."""
    now = datetime.now(UTC)

    if request.period == "custom":
        if request.start is None or request.end is None:
            raise ValueError("Start and end are required.")

        start = request.start
        end = request.end

        if start.tzinfo is None:
            start = start.replace(tzinfo=KST)
        if end.tzinfo is None:
            end = end.replace(tzinfo=KST)

        start = start.astimezone(UTC)
        end = end.astimezone(UTC)
    else:
        end = now

        if request.period == "year":
            local = now.astimezone(KST)
            year = local.year - 1
            day = min(
                local.day,
                calendar.monthrange(year, local.month)[1],
            )
            start = local.replace(year=year, day=day).astimezone(UTC)
        else:
            start = end - timedelta(days=30)

    if start >= end:
        raise ValueError("Start must be earlier than end.")
    if end > now:
        raise ValueError("End cannot be in the future.")

    return start, end


class DownloadService:
    """Manage one active download for the local application."""

    def __init__(self, client: UpbitClient, data_dir: Path) -> None:
        self.client = client
        self.data_dir = data_dir
        self._status = DownloadStatus()
        self._task: asyncio.Task[None] | None = None

    @property
    def status(self) -> DownloadStatus:
        """Return a snapshot of the current state."""
        return self._status.model_copy(deep=True)

    def start(self, request: DownloadRequest) -> DownloadStatus:
        """Validate and schedule a download without blocking the API."""
        if self._task is not None and not self._task.done():
            raise RuntimeError("A download is already running.")

        start, end = resolve_range(request)
        self._status = DownloadStatus(
            status="running",
            message="Starting download...",
        )
        self._task = asyncio.create_task(
            self._run(request, start, end)
        )
        return self.status

    async def close(self) -> None:
        """Cancel an active download during application shutdown."""
        if self._task is not None and not self._task.done():
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task

    async def _run(
        self,
        request: DownloadRequest,
        start: datetime,
        end: datetime,
    ) -> None:
        source_minutes = 60 if request.minutes == 120 else request.minutes
        source_duration = timedelta(minutes=source_minutes)
        target_duration = timedelta(minutes=request.minutes)
        duration = (end - start).total_seconds()
        cursor = end
        rows: dict[datetime, Candle] = {}

        try:
            while cursor > start:
                self._status.message = (
                    "Requesting candles; temporary failures are retried..."
                )
                page = await self.client.candles(
                    request.market,
                    source_minutes,
                    cursor,
                )
                self._status.requests += 1

                if not page:
                    break

                oldest = min(candle.time for candle in page)

                if oldest >= cursor:
                    raise RuntimeError("Pagination did not move backward.")

                for candle in page:
                    if (
                        candle.time >= start
                        and candle.time + source_duration <= end
                    ):
                        rows[candle.time] = candle

                covered = (end - max(oldest, start)).total_seconds()
                self._status.progress = min(
                    99,
                    round(covered / duration * 100, 1),
                )
                self._status.candles = len(rows)
                self._status.message = "Downloading historical candles..."
                cursor = oldest

            candles = sorted(rows.values(), key=lambda item: item.time)

            if request.minutes == 120:
                candles = aggregate_two_hours(candles)

            candles = [
                candle
                for candle in candles
                if candle.time >= start
                and candle.time + target_duration <= end
            ]

            if not candles:
                raise ValueError(
                    "No complete candles were available for this selection."
                )

            filename = (
                f"{request.market.replace('-', '_')}_{request.minutes}m_"
                f"{start:%Y%m%dT%H%M%SZ}_{end:%Y%m%dT%H%M%SZ}_"
                f"{uuid4().hex[:8]}.csv"
            )
            self._status.message = "Saving CSV..."

            await asyncio.to_thread(
                write_csv,
                self.data_dir / filename,
                candles,
            )

            self._status = DownloadStatus(
                status="completed",
                progress=100,
                candles=len(candles),
                requests=self._status.requests,
                file=filename,
                first=candles[0].time,
                last=candles[-1].time,
                message=f"Saved {len(candles):,} candles to data/{filename}",
            )
        except Exception as error:
            LOGGER.exception("Download failed")
            self._status.status = "failed"
            self._status.message = f"{type(error).__name__}: {error}"