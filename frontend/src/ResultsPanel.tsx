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
} from "lightweight-charts";

import "./ResultsPanel.css";

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

function ResultChart({ bars }: { bars: ResultBar[] }) {
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
        tickMarkFormatter: (time) => formatKst(time as number),
      },
      localization: {
        timeFormatter: (time) => formatKst(time as number),
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

    createSeriesMarkers(candles, markers);

    const byTime = new Map(bars.map((bar) => [bar.time, bar]));

    chart.subscribeCrosshairMove((event) => {
      if (event.time === undefined) return;

      const bar = byTime.get(Number(event.time));
      if (bar) setFocused(bar);
    });

    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, bars.length - 160),
      to: bars.length + 5,
    });

    return () => chart.remove();
  }, [bars]);

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
            {focused.buy && <strong className="results-buy">BUY</strong>}
            {focused.sell && (
              <strong className="results-sell">SELL</strong>
            )}
          </>
        ) : (
          <span>Move the cursor over a candle.</span>
        )}
      </div>

      <div className="results-chart" ref={containerRef} />
      <Text className="results-caption" size="xs">
        Candles and kernel estimate above · Prediction below · Times in KST
      </Text>
    </>
  );
}

export function ResultsPanel() {
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
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setResult(null);

    void getJson<ResultResponse>(
      `/api/results/${encodeURIComponent(selectedFile)}?limit=5000`,
      controller.signal
    )
      .then(setResult)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedFile]);

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
      {loading && <Text c="dimmed">Loading chart...</Text>}

      {result && result.bars.length > 0 && (
        <>
          <Text size="xs" c="dimmed" mb="sm">
            {result.filename} · {result.bars.length.toLocaleString()} candles
          </Text>
          <ResultChart bars={result.bars} />
        </>
      )}
    </section>
  );
}