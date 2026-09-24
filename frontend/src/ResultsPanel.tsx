import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Select, Text } from "@mantine/core";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type SeriesMarker,
  type UTCTimestamp,
  type Time,
} from "lightweight-charts";

import "./ResultsPanel.css";
import { attachBacktestOverlay, fetchBacktest, type BacktestData } from "./backtestOverlay";

type ResultBar = {
  time: number;
  timeUtc: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  prediction: number;
  direction: number;
  kernel: number | null;
  buy: boolean;
  sell: boolean;
};

type ResultResponse = {
  filename: string;
  bars: ResultBar[];
};

function formatKst(seconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(seconds * 1000));
}

function formatPrice(value: number | null): string {
  if (value === null) return "—";

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function ResultChart({ bars, backtest }: {
  bars: ResultBar[];
  backtest: BacktestData | null;
}) {
  const fitAllRef = useRef<() => void>(() => {});
  const containerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<ResultBar | null>(
    bars.at(-1) ?? null
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length === 0) return;

    setFocused(bars.at(-1) ?? null);

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: "#101923" },
        textColor: "#a4b9c8",
        fontFamily: '"Geist Mono", monospace',
        attributionLogo: true,
        panes: {
          separatorColor: "#29404c",
          separatorHoverColor: "#56d4d0",
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: "#1b2b35" },
        horzLines: { color: "#1b2b35" },
      },
      rightPriceScale: {
        borderColor: "#29404c",
      },
      timeScale: {
        borderColor: "#29404c",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => formatKst(time as number),
      },
      localization: {
        timeFormatter: (time: Time) => formatKst(time as number),
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#66d6c4",
      downColor: "#fb7c87",
      borderVisible: false,
      wickUpColor: "#66d6c4",
      wickDownColor: "#fb7c87",
    });

    const kernel = chart.addSeries(LineSeries, {
      color: "#f5cb6b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const prediction = chart.addSeries(
      HistogramSeries,
      {
        base: 0,
        priceFormat: {
          type: "price",
          precision: 0,
          minMove: 1,
        },
        priceLineVisible: false,
      },
      1
    );

    candles.setData(
      bars.map((bar) => ({
        time: bar.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }))
    );

    kernel.setData(
      bars
        .filter((bar) => bar.kernel !== null)
        .map((bar) => ({
          time: bar.time as UTCTimestamp,
          value: bar.kernel as number,
        }))
    );

    prediction.setData(
      bars.map((bar) => ({
        time: bar.time as UTCTimestamp,
        value: bar.prediction,
        color:
          bar.prediction > 0
            ? "#5ad0c6"
            : bar.prediction < 0
              ? "#f47786"
              : "#59707e",
      }))
    );

    const markers: SeriesMarker<UTCTimestamp>[] = bars.flatMap(
      (bar): SeriesMarker<UTCTimestamp>[] => {
        const time = bar.time as UTCTimestamp;
        const result: SeriesMarker<UTCTimestamp>[] = [];

        if (bar.buy) {
          result.push({
            time,
            position: "belowBar",
            color: "#67e1ce",
            shape: "arrowUp",
            text: "BUY",
          });
        }

        if (bar.sell) {
          result.push({
            time,
            position: "aboveBar",
            color: "#ff8490",
            shape: "arrowDown",
            text: "SELL",
          });
        }

        return result;
      }
    );

    const removeOverlay = backtest
      ? attachBacktestOverlay(chart, candles, container, bars.map((bar) => bar.time), backtest)
      : undefined;
    if (!backtest) {
      createSeriesMarkers(candles, markers.map((marker) => ({
        ...marker, text: `${marker.text} SIGNAL`,
      })));
    }
    fitAllRef.current = () => chart.timeScale().fitContent();

    const byTime = new Map(bars.map((bar) => [bar.time, bar]));

    chart.subscribeCrosshairMove((event) => {
      if (event.time === undefined) { setFocused(bars.at(-1) ?? null); return; }

      const bar = byTime.get(Number(event.time));
      if (bar) setFocused(bar);
    });

    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, bars.length - 160),
      to: bars.length + 5,
    });

    return () => {
      fitAllRef.current = () => {};
      removeOverlay?.();
      chart.remove();
    };
  }, [bars, backtest]);

  return (
    <>
      <div className="results-readout">
        {focused ? (
          <>
            <span>{formatKst(focused.time)} KST</span>
            <span>O {formatPrice(focused.open)}</span>
            <span>H {formatPrice(focused.high)}</span>
            <span>L {formatPrice(focused.low)}</span>
            <span>C {formatPrice(focused.close)}</span>
            <span>Prediction {focused.prediction}</span>
            <span>Direction {focused.direction}</span>
            <span>Kernel {formatPrice(focused.kernel)}</span>
            {focused.buy && <strong className="results-buy">BUY SIGNAL</strong>}
            {focused.sell && (
              <strong className="results-sell">SELL SIGNAL</strong>
            )}
          </>
        ) : (
          <span>Move the cursor over a candle.</span>
        )}
      </div>

      <Group justify="space-between" className="results-chart-toolbar">
        <Text size="xs">{backtest
          ? "PRICE / EXECUTIONS · PREDICTION · CUMULATIVE RETURN"
          : "PRICE / SIGNALS · PREDICTION"}</Text>
        <Button size="compact-xs" variant="subtle" onClick={() => fitAllRef.current()}>
          Fit all candles
        </Button>
      </Group>
      <div className="results-chart" ref={containerRef} />
      <Text className="results-caption" size="xs">
        {backtest
          ? "Hover a SELL FILL marker for trade details. Return includes cash and open positions valued at each candle close. Times in KST."
          : "Signal markers only. No matching baseline backtest. Times in KST."}
      </Text>
    </>
  );
}

export function ResultsPanel() {
  const [backtest, setBacktest] = useState<BacktestData | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [result, setResult] = useState<ResultResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshFiles() {
    try {
      setError(null);
      const data = await getJson<{ files: string[] }>("/api/results");
      setFiles(data.files);
      setRevision((value) => value + 1);
      setSelectedFile((current) =>
        current && data.files.includes(current)
          ? current
          : (data.files[0] ?? null)
      );
    } catch (cause) {
      setError(String(cause));
    }
  }

  useEffect(() => {
    void refreshFiles();
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setResult(null);
      setBacktest(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setResult(null);
    setBacktest(null);
    setBacktestError(null);

    void Promise.all([getJson<ResultResponse>(
      `/api/results/${encodeURIComponent(selectedFile)}?limit=10000`,
      controller.signal
    ), fetchBacktest(selectedFile, controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) setBacktestError(String(cause));
      return null;
    })])
      .then(([nextResult, nextBacktest]) => {
        if (!controller.signal.aborted) {
          setResult(nextResult);
          setBacktest(nextBacktest);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedFile, revision]);

  return (
    <section className="results-panel">
      <Group justify="space-between" align="end" mb="lg">
        <Select
          label="RESULT FILE"
          placeholder="Select a CSV"
          searchable
          data={files}
          value={selectedFile}
          onChange={setSelectedFile}
          className="results-file-select"
        />
        <Button variant="light" onClick={() => void refreshFiles()}>
          Refresh files
        </Button>
      </Group>

      {error && <Alert color="red" mb="md">{error}</Alert>}
      {!loading && files.length === 0 && (
        <Text c="dimmed">No CSV files found in result/.</Text>
      )}
      {backtestError && <Alert color="yellow" mb="md">{backtestError}</Alert>}
      {loading && <Text c="dimmed">Loading chart...</Text>}

      {result && result.bars.length > 0 && (
        <>
          <Text size="xs" c="dimmed" mb="sm">
            {result.filename} · {result.bars.length.toLocaleString()} candles
          </Text>
          {backtest && (
            <Group className="results-run-summary" gap="xl" mb="md">
              <Text size="sm">Net return {Number(backtest.summary.return_pct).toFixed(2)}%</Text>
              <Text size="sm">Closed trades {backtest.summary.completed_trades}</Text>
              <Text size="xs">Fee {backtest.summary.fee_bps} bps / side</Text>
              <Text size="xs">Slippage {backtest.summary.slippage_bps} bps / side</Text>
            </Group>
          )}
          <ResultChart bars={result.bars} backtest={backtest} />
        </>
      )}
    </section>
  );
}