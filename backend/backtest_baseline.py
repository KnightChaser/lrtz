"""Backtest confirmed Lorentzian Buy/Sell signals on Upbit spot candles."""

import argparse
import csv
import json
from datetime import datetime
from decimal import Decimal, ROUND_DOWN
from pathlib import Path


UNIT = Decimal("0.00000001")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Verified score CSV")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("backtest/baseline"),
    )
    parser.add_argument("--expected-start", default=None)
    parser.add_argument("--cash", type=Decimal, default=Decimal("1000000"))
    parser.add_argument("--fee-bps", type=Decimal, default=Decimal("5"))
    parser.add_argument(
        "--slippage-bps",
        type=Decimal,
        default=Decimal("5"),
    )
    return parser.parse_args()


def write_csv(path, rows, fields):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def backtest(rows, starting_cash, fee_bps, slippage_bps):
    fee_rate = fee_bps / Decimal("10000")
    slip_rate = slippage_bps / Decimal("10000")

    cash = starting_cash
    quantity = Decimal("0")
    entry = None
    first_buy_index = None
    fills = []
    trades = []
    equity = []
    peak = starting_cash
    max_drawdown = Decimal("0")

    for index, row in enumerate(rows):
        # Execute only signals confirmed at the previous candle's close.
        if index > 0:
            previous = rows[index - 1]

            if quantity > 0 and previous["Sell"] == "1":
                price = Decimal(row["open"]) * (1 - slip_rate)
                gross = quantity * price
                fee = gross * fee_rate
                cash += gross - fee

                fills.append({
                    "signal_time_utc": previous["time_utc"],
                    "fill_time_utc": row["time_utc"],
                    "side": "SELL",
                    "price": str(price),
                    "quantity": str(quantity),
                    "fee": str(fee),
                    "cash_after": str(cash),
                })
                trades.append({
                    "entry_time_utc": entry["time"],
                    "exit_time_utc": row["time_utc"],
                    "entry_price": str(entry["price"]),
                    "exit_price": str(price),
                    "pnl": str(cash - entry["equity_before"]),
                    "return_pct": str(
                        (cash / entry["equity_before"] - 1) * 100
                    ),
                })

                quantity = Decimal("0")
                entry = None

            elif quantity == 0 and previous["Buy"] == "1":
                price = Decimal(row["open"]) * (1 + slip_rate)
                equity_before = cash
                quantity = (
                    cash / (price * (1 + fee_rate))
                ).quantize(UNIT, rounding=ROUND_DOWN)

                if quantity > 0:
                    gross = quantity * price
                    fee = gross * fee_rate
                    cash -= gross + fee
                    entry = {
                        "time": row["time_utc"],
                        "price": price,
                        "equity_before": equity_before,
                    }

                    if first_buy_index is None:
                        first_buy_index = index

                    fills.append({
                        "signal_time_utc": previous["time_utc"],
                        "fill_time_utc": row["time_utc"],
                        "side": "BUY",
                        "price": str(price),
                        "quantity": str(quantity),
                        "fee": str(fee),
                        "cash_after": str(cash),
                    })

        value = cash + quantity * Decimal(row["close"])
        peak = max(peak, value)
        drawdown = (value / peak - 1) * 100
        max_drawdown = min(max_drawdown, drawdown)

        equity.append({
            "time_utc": row["time_utc"],
            "cash": str(cash),
            "quantity": str(quantity),
            "equity": str(value),
            "drawdown_pct": str(drawdown),
        })

    ending_equity = Decimal(equity[-1]["equity"])
    summary = {
        "start_utc": rows[0]["time_utc"],
        "end_utc": rows[-1]["time_utc"],
        "candles": len(rows),
        "starting_cash": str(starting_cash),
        "ending_equity": str(ending_equity),
        "return_pct": str(
            (ending_equity / starting_cash - 1) * 100
        ),
        "max_drawdown_pct": str(max_drawdown),
        "completed_trades": len(trades),
        "open_quantity": str(quantity),
        "fee_bps": str(fee_bps),
        "slippage_bps": str(slippage_bps),
        "first_buy_fill_utc": (
            rows[first_buy_index]["time_utc"]
            if first_buy_index is not None
            else None
        ),
    }
    return fills, trades, equity, summary


def main():
    args = parse_args()

    if args.cash <= 0 or args.fee_bps < 0 or args.slippage_bps < 0:
        raise SystemExit(
            "Cash must be positive and rates must be nonnegative."
        )
    if args.fee_bps >= 10000 or args.slippage_bps >= 10000:
        raise SystemExit("Rates must each be below 10000 bps.")

    with args.input.open(newline="", encoding="utf-8-sig") as stream:
        rows = list(csv.DictReader(stream))

    required = {
        "time_utc",
        "open",
        "close",
        "Buy",
        "Sell",
        "Prediction",
    }
    if not rows or not required.issubset(rows[0]):
        raise SystemExit(
            f"CSV must contain: {', '.join(sorted(required))}."
        )

    if args.expected_start and rows[0]["time_utc"] != args.expected_start:
        raise SystemExit(
            f"Unexpected start: {rows[0]['time_utc']}; "
            f"expected {args.expected_start}."
        )

    times = [
        datetime.fromisoformat(
            row["time_utc"].replace("Z", "+00:00")
        )
        for row in rows
    ]
    if any(
        left >= right
        for left, right in zip(times, times[1:])
    ):
        raise SystemExit(
            "Candles must have strictly increasing UTC times."
        )

    if any(
        Decimal(row["open"]) <= 0 or Decimal(row["close"]) <= 0
        for row in rows
    ):
        raise SystemExit(
            "All open and close prices must be positive."
        )

    fills, trades, equity, summary = backtest(
        rows,
        args.cash,
        args.fee_bps,
        args.slippage_bps,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)

    write_csv(
        args.output_dir / "fills.csv",
        fills,
        [
            "signal_time_utc",
            "fill_time_utc",
            "side",
            "price",
            "quantity",
            "fee",
            "cash_after",
        ],
    )
    write_csv(
        args.output_dir / "trades.csv",
        trades,
        [
            "entry_time_utc",
            "exit_time_utc",
            "entry_price",
            "exit_price",
            "pnl",
            "return_pct",
        ],
    )
    write_csv(
        args.output_dir / "equity.csv",
        equity,
        [
            "time_utc",
            "cash",
            "quantity",
            "equity",
            "drawdown_pct",
        ],
    )

    (args.output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()