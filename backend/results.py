"""Expose locally saved classification results to the frontend."""

import csv
import math
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/results", tags=["results"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RESULT_DIR = PROJECT_ROOT / "result"


def timestamp_seconds(value: str) -> int:
    """Convert a CSV timestamp to Unix seconds."""
    value = value.strip()

    if value.isdigit():
        number = int(value)
        return number // 1000 if number > 100_000_000_000 else number

    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return int(parsed.timestamp())


def number(value: str | None, *, required: bool = False) -> float | None:
    """Parse a finite CSV number, allowing empty optional cells."""
    if value is None or value.strip() == "":
        if required:
            raise ValueError("missing required numeric value")
        return None

    parsed = float(value)

    if not math.isfinite(parsed):
        raise ValueError("non-finite numeric value")

    return parsed


def result_files() -> list[Path]:
    """List CSV files directly inside the result directory."""
    if not RESULT_DIR.is_dir():
        return []

    return sorted(
        (
            path
            for path in RESULT_DIR.glob("*.csv")
            if path.is_file() and not path.is_symlink()
        ),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )


@router.get("")
def list_results() -> dict[str, list[str]]:
    return {"files": [path.name for path in result_files()]}


@router.get("/{filename}")
def read_result(
    filename: str,
    limit: int = Query(default=3000, ge=1, le=10000),
) -> dict[str, object]:
    available = {path.name: path for path in result_files()}
    path = available.get(filename)

    if path is None:
        raise HTTPException(status_code=404, detail="Result file not found")

    try:
        with path.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            fields = set(reader.fieldnames or [])
            required = {
                "open",
                "high",
                "low",
                "close",
                "Prediction",
            }

            if not required.issubset(fields):
                raise ValueError(
                    "CSV must contain OHLC and Prediction columns"
                )

            if "time_utc" not in fields and "time" not in fields:
                raise ValueError(
                    "CSV must contain time_utc or time"
                )

            source_rows = deque(reader, maxlen=limit)

        bars = []

        for row in source_rows:
            time_text = row.get("time_utc") or row.get("time") or ""
            if not time_text:
                raise ValueError("a candle has no timestamp")

            bars.append({
                "time": timestamp_seconds(time_text),
                "timeUtc": time_text,
                "open": number(row.get("open"), required=True),
                "high": number(row.get("high"), required=True),
                "low": number(row.get("low"), required=True),
                "close": number(row.get("close"), required=True),
                "volume": number(row.get("volume")),
                "prediction": int(
                    number(row.get("Prediction"), required=True)
                ),
                "direction": int(number(row.get("Direction")) or 0),
                "kernel": number(
                    row.get("Kernel Regression Estimate")
                ),
                "buy": row.get("Buy", "").strip() == "1",
                "sell": row.get("Sell", "").strip() == "1",
            })

        bars.sort(key=lambda bar: bar["time"])

        if len({bar["time"] for bar in bars}) != len(bars):
            raise ValueError("CSV contains duplicate candle timestamps")

    except (OSError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "filename": path.name,
        "bars": bars,
    }