"""Provide an asynchronous client for Upbit public market data."""

import asyncio
import re
from datetime import UTC, datetime
from typing import Any

import httpx

from .models import Candle, Market

BASE_URL = "https://api.upbit.com/v1"


class UpbitClient:
    """Retrieve market lists and paginated candle data."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=30)
        self._markets: list[Market] | None = None

    async def close(self) -> None:
        """Release the underlying HTTP connection pool."""
        await self._client.aclose()

    async def markets(self) -> list[Market]:
        """Return a cached list of trading pairs."""
        if self._markets is None:
            response = await self._client.get(f"{BASE_URL}/market/all")
            response.raise_for_status()
            self._markets = sorted(
                [
                    Market(
                        market=item["market"],
                        name=item["english_name"],
                    )
                    for item in response.json()
                ],
                key=lambda market: market.market,
            )

        return self._markets

    async def candles(
        self,
        market: str,
        minutes: int,
        before: datetime,
    ) -> list[Candle]:
        """Return up to 200 candles preceding the given timestamp."""
        params = {
            "market": market,
            "count": 200,
            "to": before.astimezone(UTC).isoformat(),
        }

        for attempt in range(6):
            try:
                response = await self._client.get(
                    f"{BASE_URL}/candles/minutes/{minutes}",
                    params=params,
                )
            except httpx.TransportError:
                if attempt == 5:
                    raise
                await asyncio.sleep(min(2 ** (attempt + 1), 30))
                continue

            if response.status_code == 418:
                raise RuntimeError(
                    "Upbit temporarily blocked this IP. "
                    "Wait for the block to expire before retrying."
                )

            if response.status_code == 429 or response.status_code >= 500:
                if attempt == 5:
                    response.raise_for_status()
                await asyncio.sleep(min(2 ** (attempt + 1), 60))
                continue

            response.raise_for_status()

            remaining = response.headers.get("Remaining-Req", "")
            match = re.search(r"(?:^|;)\s*sec=(\d+)", remaining)
            delay = 1.1 if match and int(match.group(1)) <= 1 else 0.25
            await asyncio.sleep(delay)

            return [
                self._parse_candle(item)
                for item in response.json()
            ]

        raise RuntimeError("Unable to retrieve Upbit candles.")

    @staticmethod
    def _parse_candle(item: dict[str, Any]) -> Candle:
        """Translate an Upbit response into the internal candle model."""
        timestamp = datetime.fromisoformat(
            item["candle_date_time_utc"]
        ).replace(tzinfo=UTC)

        return Candle(
            time=timestamp,
            open=item["opening_price"],
            high=item["high_price"],
            low=item["low_price"],
            close=item["trade_price"],
            volume=item["candle_acc_trade_volume"],
            turnover=item["candle_acc_trade_price"],
        )