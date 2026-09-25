"""List and load strategy backtests for a saved classification result."""

import csv
import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from .results import RESULT_DIR, number, result_files, timestamp_seconds

router = APIRouter(prefix="/api/strategies", tags=["strategies"])
BACKTEST_DIR = RESULT_DIR.parent / "backtest"
REQUIRED_FILES = ("fills.csv", "trades.csv", "equity.csv")


def read_summary(directory: Path, result_name: str) -> dict[str, Any] | None:
    """Return metadata only when a strategy belongs to the chosen result."""
    summary_path = directory / "summary.json"
    if not summary_path.is_file() or summary_path.is_symlink():
        return None

    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    if not isinstance(summary, dict):
        return None
    if summary.get("source_csv") != result_name:
        return None
    if any(not (directory / name).is_file() for name in REQUIRED_FILES):
        return None

    return summary


def available_strategies(
    result_name: str,
) -> dict[str, tuple[Path, dict[str, Any]]]:
    """Discover direct child folders whose metadata matches a result CSV."""
    available_results = {path.name for path in result_files()}
    if result_name not in available_results:
        raise HTTPException(status_code=404, detail="Result file not found")

    if not BACKTEST_DIR.is_dir():
        return {}

    strategies = {}
    for directory in sorted(BACKTEST_DIR.iterdir()):
        if not directory.is_dir() or directory.is_symlink():
            continue

        summary = read_summary(directory, result_name)
        if summary is not None:
            strategies[directory.name] = (directory, summary)

    return strategies


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    """Skip blank trailing rows produced by some CSV editors."""
    if path.is_symlink():
        raise ValueError("Strategy files cannot be symlinks")

    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        return [
            row
            for row in reader
            if any(value and value.strip() for value in row.values())
        ]


def parse_fills(directory: Path) -> list[dict[str, Any]]:
    fills = []
    for row in read_csv_rows(directory / "fills.csv"):
        side = row["side"]
        if side not in {"BUY", "SELL"}:
            raise ValueError(f"Invalid fill side: {side}")

        fills.append({
            "time": timestamp_seconds(row["fill_time_utc"]),
            "side": side,
            "price": number(row["price"], required=True),
        })

    return fills


def parse_trades(directory: Path) -> list[dict[str, Any]]:
    trades = []
    for row in read_csv_rows(directory / "trades.csv"):
        trades.append({
            "entryTime": timestamp_seconds(row["entry_time_utc"]),
            "exitTime": timestamp_seconds(row["exit_time_utc"]),
            "entryPrice": number(row["entry_price"], required=True),
            "exitPrice": number(row["exit_price"], required=True),
            "returnPct": number(row["return_pct"], required=True),
            "pnl": number(row["pnl"], required=True),
        })

    return trades


def parse_equity(
    directory: Path,
    summary: dict[str, Any],
) -> list[dict[str, float | int]]:
    starting_cash = number(summary.get("starting_cash"), required=True)
    if starting_cash <= 0:
        raise ValueError("Starting cash must be positive")

    equity = []
    for row in read_csv_rows(directory / "equity.csv"):
        current_equity = number(row["equity"], required=True)
        equity.append({
            "time": timestamp_seconds(row["time_utc"]),
            "returnPct": (current_equity / starting_cash - 1) * 100,
        })

    if not equity or len(equity) != int(summary["candles"]):
        raise ValueError("Equity length does not match summary")

    start = timestamp_seconds(summary["start_utc"])
    end = timestamp_seconds(summary["end_utc"])
    if equity[0]["time"] != start or equity[-1]["time"] != end:
        raise ValueError("Equity dates do not match summary")

    return equity


@router.get("")
def list_strategies(result: str = Query(...)) -> dict[str, list[dict]]:
    """Return strategies associated with exactly one saved result file."""
    strategies = []
    for strategy_id, (_, summary) in available_strategies(result).items():
        strategies.append({
            "id": strategy_id,
            "name": strategy_id.replace("_", " ").title(),
            "returnPct": number(summary.get("return_pct")),
            "completedTrades": summary.get("completed_trades"),
            "feeBps": number(summary.get("fee_bps")),
            "slippageBps": number(summary.get("slippage_bps")),
        })

    return {"strategies": strategies}


@router.get("/{strategy_id}")
def read_strategy(strategy_id: str, result: str = Query(...)) -> dict[str, Any]:
    """Read one strategy without trusting arbitrary client-supplied paths."""
    available = available_strategies(result)
    if strategy_id not in available:
        raise HTTPException(
            status_code=404,
            detail="Strategy not found for this result",
        )

    directory, summary = available[strategy_id]
    try:
        fills = parse_fills(directory)
        trades = parse_trades(directory)
        equity = parse_equity(directory, summary)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "id": strategy_id,
        "fills": fills,
        "trades": trades,
        "equity": equity,
    }
