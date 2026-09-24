"""Serve baseline executions and portfolio values for their source result."""

import csv
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from .results import number, timestamp_seconds

router = APIRouter(prefix="/api/backtest", tags=["backtest"])
BASELINE_DIR = Path(__file__).resolve().parent.parent / "backtest" / "baseline"


def read_rows(filename: str) -> list[dict[str, str]]:
    """Skip completely empty CSV rows, including trailing comma-only rows."""
    with (BASELINE_DIR / filename).open(
        newline="", encoding="utf-8-sig"
    ) as stream:
        return [
            row
            for row in csv.DictReader(stream)
            if any(value and str(value).strip() for value in row.values())
        ]


@router.get("/baseline")
def get_baseline(result: str = Query(...)) -> dict[str, object]:
    """Return chart data for the selected score file."""
    try:
        summary = json.loads(
            (BASELINE_DIR / "summary.json").read_text("utf-8-sig")
        )
        if summary.get("source_csv") != result:
            raise HTTPException(
                404, "No baseline backtest for this result file."
            )
        starting_cash = number(str(summary["starting_cash"]), required=True)
        if starting_cash <= 0:
            raise ValueError("Starting cash must be positive.")

        fills = []
        for index, row in enumerate(read_rows("fills.csv")):
            if row["side"] not in {"BUY", "SELL"}:
                raise ValueError("Invalid fill side.")
            fills.append(
                {
                    "id": f"fill-{index}",
                    "time": timestamp_seconds(row["fill_time_utc"]),
                    "side": row["side"],
                    "price": number(row["price"], required=True),
                    "quantity": number(row["quantity"], required=True),
                }
            )

        trades = [
            {
                "entryTime": timestamp_seconds(row["entry_time_utc"]),
                "exitTime": timestamp_seconds(row["exit_time_utc"]),
                "entryPrice": number(row["entry_price"], required=True),
                "exitPrice": number(row["exit_price"], required=True),
                "pnl": number(row["pnl"], required=True),
                "returnPct": number(row["return_pct"], required=True),
            }
            for row in read_rows("trades.csv")
        ]

        equity = [
            {
                "time": timestamp_seconds(row["time_utc"]),
                "value": (
                    number(row["equity"], required=True) / starting_cash - 1
                )
                * 100,
            }
            for row in read_rows("equity.csv")
        ]
        equity.sort(key=lambda point: point["time"])
        if not equity or len({point["time"] for point in equity}) != len(
            equity
        ):
            raise ValueError("Equity timestamps must be nonempty and unique.")
        fills.sort(key=lambda fill: fill["time"])
        return {
            "summary": summary,
            "fills": fills,
            "trades": trades,
            "equity": equity,
        }
    except FileNotFoundError as exc:
        raise HTTPException(
            404, "Baseline backtest files were not found."
        ) from exc
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, f"Invalid backtest files: {exc}") from exc
