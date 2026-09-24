"""Score complete Upbit candles using the upstream Python port."""

import argparse
import csv
from datetime import datetime
from pathlib import Path

from lorentzian_classification import (
    RESULT_FIELDNAMES,
    LorentzianClassification,
    Settings,
    result_to_mapping,
)

OHLC_COLUMNS = {"time", "open", "high", "low", "close"}


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def score_file(input_path: Path, output_path: Path, window: int = 2500) -> None:
    """Store upstream results alongside original Upbit OHLCV columns."""
    if window <= 2000:
        raise ValueError("window must exceed the upstream 2000-bar history setting")

    with input_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        input_fields = reader.fieldnames or []
        required = {"time_utc", "open", "high", "low", "close"}

        if not required.issubset(input_fields):
            raise ValueError(
                "input must contain time_utc, open, high, low, close"
            )

        rows = [
            row
            for row in reader
            if row.get("is_closed", "true").strip().lower()
            not in {"false", "0"}
        ]

    rows.sort(key=lambda row: parse_time(row["time_utc"]))

    if len(rows) < 2001:
        raise ValueError("at least 2001 complete candles are required")

    rows = rows[-window:]
    timestamps = [parse_time(row["time_utc"]) for row in rows]

    if len(timestamps) != len(set(timestamps)):
        raise ValueError("input contains duplicate candle timestamps")

    records = [{**row, "time": row["time_utc"]} for row in rows]
    settings = Settings(
        include_full_history=True,
    )

    model = LorentzianClassification(records, settings=settings)

    result_fields = [
        name for name in RESULT_FIELDNAMES if name not in OHLC_COLUMNS
    ]
    output_fields = list(dict.fromkeys([*input_fields, *result_fields]))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_suffix(output_path.suffix + ".tmp")

    try:
        with temporary_path.open(
            "w", newline="", encoding="utf-8"
        ) as handle:
            writer = csv.DictWriter(handle, fieldnames=output_fields)
            writer.writeheader()

            for row, result in zip(rows, model.results, strict=True):
                scored = result_to_mapping(result)
                writer.writerow({
                    **row,
                    **{key: scored[key] for key in result_fields},
                })

        temporary_path.replace(output_path)
    finally:
        temporary_path.unlink(missing_ok=True)

    print(f"Saved {len(rows):,} candles to {output_path}")
    print(f"Classification window: last {min(len(rows), 2001):,} candles")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Upbit OHLCV CSV")
    parser.add_argument("--output", type=Path, help="Destination CSV")
    parser.add_argument("--window", type=int, default=2500)
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[3]
    destination = (
        args.output
        or project_root / "result" / f"{args.input.stem}_lc.csv"
    )
    score_file(args.input, destination, window=args.window)


if __name__ == "__main__":
    main()