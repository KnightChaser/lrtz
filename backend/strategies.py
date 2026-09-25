"""Discover and serve strategy backtests tied to a classification CSV."""

import csv
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from .results import RESULT_DIR, number, result_files, timestamp_seconds

router = APIRouter(prefix="/api/strategies", tags=["strategies"])
BACKTEST_DIR = RESULT_DIR.parent / "backtest"


def _summary(directory: Path, result: str) -> dict | None:
    path = directory / "summary.json"
    if not path.is_file() or path.is_symlink():
        return None
    try:
        summary = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(summary, dict) or summary.get("source_csv") != result:
            return None
        if not all((directory / name).is_file() for name in
                   ("fills.csv", "trades.csv", "equity.csv")):
            return None
        return summary
    except (OSError, ValueError):
        return None


def _available(result: str) -> dict[str, tuple[Path, dict]]:
    if result not in {path.name for path in result_files()}:
        raise HTTPException(404, "Result file not found")
    if not BACKTEST_DIR.is_dir():
        return {}
    return {
        path.name: (path, summary)
        for path in sorted(BACKTEST_DIR.iterdir())
        if path.is_dir() and not path.is_symlink()
        if (summary := _summary(path, result)) is not None
    }


def _rows(path: Path) -> list[dict[str, str]]:
    if path.is_symlink():
        raise ValueError("Strategy files cannot be symlinks")
    with path.open(newline="", encoding="utf-8-sig") as stream:
        return [row for row in csv.DictReader(stream)
                if any(value and value.strip() for value in row.values())]


@router.get("")
def list_strategies(result: str = Query(...)) -> dict:
    return {"strategies": [
        {"id": key, "name": key.replace("_", " ").title(),
         "returnPct": number(summary.get("return_pct")),
         "completedTrades": summary.get("completed_trades"),
         "feeBps": number(summary.get("fee_bps")),
         "slippageBps": number(summary.get("slippage_bps"))}
        for key, (_, summary) in _available(result).items()
    ]}


@router.get("/{strategy_id}")
def read_strategy(strategy_id: str, result: str = Query(...)) -> dict:
    available = _available(result)
    if strategy_id not in available:
        raise HTTPException(404, "Strategy not found for this result")
    directory, summary = available[strategy_id]
    try:
        fills = [{
            "time": timestamp_seconds(row["fill_time_utc"]),
            "side": row["side"],
            "price": number(row["price"], required=True),
        } for row in _rows(directory / "fills.csv")]
        if any(row["side"] not in ("BUY", "SELL") for row in fills):
            raise ValueError("Invalid fill side")
        trades = [{
            "entryTime": timestamp_seconds(row["entry_time_utc"]),
            "exitTime": timestamp_seconds(row["exit_time_utc"]),
            "entryPrice": number(row["entry_price"], required=True),
            "exitPrice": number(row["exit_price"], required=True),
            "returnPct": number(row["return_pct"], required=True),
            "pnl": number(row["pnl"], required=True),
        } for row in _rows(directory / "trades.csv")]
        starting_cash = number(summary.get("starting_cash"), required=True)
        if starting_cash <= 0:
            raise ValueError("Starting cash must be positive")
        equity = [{
            "time": timestamp_seconds(row["time_utc"]),
            "returnPct": (number(row["equity"], required=True)
                          / starting_cash - 1) * 100,
        } for row in _rows(directory / "equity.csv")]
        if not equity or len(equity) != int(summary["candles"]):
            raise ValueError("Equity length does not match summary")
        if (equity[0]["time"] != timestamp_seconds(summary["start_utc"])
                or equity[-1]["time"] != timestamp_seconds(summary["end_utc"])):
            raise ValueError("Equity dates do not match summary")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"id": strategy_id, "fills": fills, "trades": trades,
            "equity": equity}
