"""Aggregate candles and save reusable OHLCV datasets."""

import csv
from collections import defaultdict
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

from .models import Candle

KST = timezone(timedelta(hours=9))
CSV_FIELDS = [
    "time_utc",
    "time_kst",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "turnover",
]


def aggregate_two_hours(candles: list[Candle]) -> list[Candle]:
    """Combine complete hourly pairs using KST midnight boundaries."""
    groups: dict[datetime, list[Candle]] = defaultdict(list)

    for candle in sorted(candles, key=lambda item: item.time):
        local = candle.time.astimezone(KST)
        start = local.replace(
            hour=local.hour // 2 * 2,
            minute=0,
            second=0,
            microsecond=0,
        ).astimezone(UTC)
        groups[start].append(candle)

    result: list[Candle] = []

    for start, items in sorted(groups.items()):
        expected = [start, start + timedelta(hours=1)]

        # Do not synthesize candles when an hourly source is missing.
        if [item.time for item in items] != expected:
            continue

        first, last = items
        result.append(
            Candle(
                time=start,
                open=first.open,
                high=max(first.high, last.high),
                low=min(first.low, last.low),
                close=last.close,
                volume=first.volume + last.volume,
                turnover=first.turnover + last.turnover,
            )
        )

    return result


def write_csv(path: Path, candles: list[Candle]) -> None:
    """Write candles chronologically and replace the file atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".csv.tmp")

    try:
        with temporary.open("w", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=CSV_FIELDS)
            writer.writeheader()

            for candle in sorted(candles, key=lambda item: item.time):
                values = candle.model_dump(exclude={"time"})
                writer.writerow(
                    {
                        "time_utc": candle.time.astimezone(UTC)
                        .isoformat()
                        .replace("+00:00", "Z"),
                        "time_kst": candle.time.astimezone(KST).isoformat(),
                        **values,
                    }
                )

        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)