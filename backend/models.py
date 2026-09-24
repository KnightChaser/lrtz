"""Define API schemas and internal candle models."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class DownloadRequest(BaseModel):
    """Describe an OHLCV download request."""

    market: str = Field(
        default="KRW-BTC",
        pattern=r"^[A-Z0-9]+-[A-Z0-9]+$",
    )
    minutes: Literal[1, 3, 5, 10, 15, 30, 60, 120, 240] = 60
    period: Literal["month", "year", "custom"] = "year"
    start: datetime | None = None
    end: datetime | None = None


class DownloadStatus(BaseModel):
    """Expose the state of the current download."""

    status: Literal["idle", "running", "completed", "failed"] = "idle"
    progress: float = 0
    candles: int = 0
    requests: int = 0
    message: str = "Choose your settings and start a download."
    file: str | None = None
    first: datetime | None = None
    last: datetime | None = None


class Market(BaseModel):
    """Describe an Upbit trading pair."""

    market: str
    name: str


class Candle(BaseModel):
    """Represent one candle using its UTC opening time."""

    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    turnover: float