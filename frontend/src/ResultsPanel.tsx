import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Group, Select, Text } from "@mantine/core";
import {
  CandlestickSeries, HistogramSeries, LineSeries, createChart,
  createSeriesMarkers, type IChartApi, type ISeriesApi,
  type ISeriesMarkersPluginApi, type SeriesMarker, type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import "./ResultsPanel.css";

type Bar = {
  time: number; open: number; high: number; low: number; close: number;
  prediction: number; direction: number; kernel: number | null;
  buy: boolean; sell: boolean;
};
type Result = { filename: string; bars: Bar[] };
type StrategyInfo = {
  id: string; name: string; returnPct: number; completedTrades: number;
  feeBps: number; slippageBps: number;
};
type Fill = { time: number; side: "BUY" | "SELL"; price: number };
type Trade = {
  entryTime: number; exitTime: number; entryPrice: number; exitPrice: number;
  returnPct: number; pnl: number;
};
type Strategy = {
  id: string; fills: Fill[]; trades: Trade[];
  equity: { time: number; returnPct: number }[];
};
const COLORS = ["#69d6c6", "#eaa9ff", "#ffca70", "#86afff", "#ff8591", "#b1de79"];

function kst(seconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(seconds * 1000));
}
function price(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US", {
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

type ChartHandle = {
  chart: IChartApi; candles: ISeriesApi<"Candlestick">;
  markerPlugin: ISeriesMarkersPluginApi<Time>;
  lines: Map<string, ISeriesApi<"Line">>;
};

function ResultChart({ result, infos, strategies, enabled }: {
  result: Result; infos: StrategyInfo[];
  strategies: Record<string, Strategy>; enabled: string[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<ChartHandle | null>(null);
  const [focused, setFocused] = useState<Bar | null>(result.bars.at(-1) ?? null);
  const [hovered, setHovered] = useState<{ id: string; trade: Trade }[]>([]);
  const [fitAll, setFitAll] = useState(0);

  useEffect(() => {
    if (!container.current || !result.bars.length) return;
    const bars = result.bars;
    setFocused(bars.at(-1) ?? null);
    setHovered([]);
    const chart = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { color: "#101923" }, textColor: "#a4b9c8",
        fontFamily: '"Geist Mono", monospace', attributionLogo: true,
        panes: { separatorColor: "#29404c", separatorHoverColor: "#56d4d0", enableResize: true },
      },
      grid: { vertLines: { color: "#1b2b35" }, horzLines: { color: "#1b2b35" } },
      rightPriceScale: { borderColor: "#29404c" },
      timeScale: {
        borderColor: "#29404c", timeVisible: true, secondsVisible: false,
        tickMarkFormatter: (time: Time) => kst(Number(time)),
      },
      localization: { timeFormatter: (time: Time) => kst(Number(time)) },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#66d6c4", downColor: "#fb7c87", borderVisible: false,
      wickUpColor: "#66d6c4", wickDownColor: "#fb7c87",
    });
    const kernel = chart.addSeries(LineSeries, {
      color: "#f5cb6b", lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
    });
    const prediction = chart.addSeries(HistogramSeries, {
      base: 0, priceFormat: { type: "price", precision: 0, minMove: 1 },
      priceLineVisible: false,
    }, 1);
    candles.setData(bars.map((bar) => ({
      time: bar.time as UTCTimestamp, open: bar.open, high: bar.high,
      low: bar.low, close: bar.close,
    })));
    kernel.setData(bars.filter((bar) => bar.kernel !== null).map((bar) => ({
      time: bar.time as UTCTimestamp, value: bar.kernel as number,
    })));
    prediction.setData(bars.map((bar) => ({
      time: bar.time as UTCTimestamp, value: bar.prediction,
      color: bar.prediction > 0 ? "#5ad0c6" : bar.prediction < 0 ? "#f47786" : "#59707e",
    })));
    const markerPlugin = createSeriesMarkers(candles, []);
    handle.current = { chart, candles, markerPlugin, lines: new Map() };
    const byTime = new Map(bars.map((bar) => [bar.time, bar]));
    chart.subscribeCrosshairMove((event) => {
      if (event.time === undefined) { setHovered([]); return; }
      const bar = byTime.get(Number(event.time));
      if (bar) setFocused(bar);
      // The trade lookup is stored on the handle so toggles do not rebuild the chart.
      const matches = hoverLookup.current.get(Number(event.time)) ?? [];
      setHovered(matches);
    });
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, bars.length - 160), to: bars.length + 5,
    });
    return () => { handle.current = null; chart.remove(); };
  }, [result]);

  const hoverLookup = useRef(new Map<number, { id: string; trade: Trade }[]>());
  useEffect(() => {
    const current = handle.current;
    if (!current) return;
    const visible = enabled.filter((id) => strategies[id]);
    const dates = new Set(result.bars.map((bar) => bar.time));
    const markers: SeriesMarker<Time>[] = [];
    const lookup = new Map<number, { id: string; trade: Trade }[]>();
    const colorFor = (id: string) => COLORS[Math.max(0, infos.findIndex((info) => info.id === id)) % COLORS.length];
    for (const id of visible) {
      const strategy = strategies[id];
      const color = colorFor(id);
      let line = current.lines.get(id);
      if (!line) {
        line = current.chart.addSeries(LineSeries, {
          color, lineWidth: 2, title: id,
          priceFormat: { type: "custom", minMove: 0.01,
            formatter: (value: number) => `${value.toFixed(2)}%` },
        }, 2);
        current.lines.set(id, line);
      }
      line.setData(strategy.equity.filter((point) => dates.has(point.time)).map((point) => ({
        time: point.time as UTCTimestamp, value: point.returnPct,
      })));
      strategy.fills.filter((fill) => dates.has(fill.time)).forEach((fill) => markers.push({
        time: fill.time as UTCTimestamp, position: fill.side === "BUY" ? "belowBar" : "aboveBar",
        color, shape: fill.side === "BUY" ? "arrowUp" : "arrowDown",
        text: `${id} ${fill.side}`,
      }));
      strategy.trades.filter((trade) => dates.has(trade.exitTime)).forEach((trade) => {
        const list = lookup.get(trade.exitTime) ?? [];
        list.push({ id, trade });
        lookup.set(trade.exitTime, list);
      });
    }
    for (const [id, line] of current.lines) {
      if (!visible.includes(id)) { current.chart.removeSeries(line); current.lines.delete(id); }
    }
    if (!infos.length) {
      result.bars.forEach((bar) => {
        if (bar.buy) markers.push({ time: bar.time as UTCTimestamp,
          position: "belowBar", color: "#67e1ce", shape: "arrowUp", text: "SIGNAL BUY" });
        if (bar.sell) markers.push({ time: bar.time as UTCTimestamp,
          position: "aboveBar", color: "#ff8490", shape: "arrowDown", text: "SIGNAL SELL" });
      });
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    current.markerPlugin.setMarkers(markers);
    hoverLookup.current = lookup;
    setHovered([]);
    const panes = current.chart.panes();
    panes[0]?.setStretchFactor(6);
    panes[1]?.setStretchFactor(2);
    panes[2]?.setStretchFactor(visible.length ? 3 : 0.01);
  }, [enabled, infos, result, strategies]);

  return <>
    <div className="results-readout">
      {focused && <>
        <span>{kst(focused.time)} KST</span>
        <span>O {price(focused.open)}</span><span>H {price(focused.high)}</span>
        <span>L {price(focused.low)}</span><span>C {price(focused.close)}</span>
        <span>Prediction {focused.prediction}</span>
        <span>Direction {focused.direction}</span><span>Kernel {price(focused.kernel)}</span>
      </>}
      <Button size="xs" variant="subtle" onClick={() => setFitAll((n) => n + 1)}>Fit all candles</Button>
    </div>
    <div className="results-chart-wrap">
      <div className="results-chart" ref={container} />
      {hovered.length > 0 && <div className="results-trade-tooltip">
        {hovered.map(({ id, trade }) => <div key={`${id}-${trade.exitTime}`}>
          <strong>{id} · CLOSED TRADE</strong>
          <span>Entry: {kst(trade.entryTime)} KST · {price(trade.entryPrice)} KRW</span>
          <span>Exit: {kst(trade.exitTime)} KST · {price(trade.exitPrice)} KRW</span>
          <span>Net return: {trade.returnPct.toFixed(2)}% · PnL: {price(trade.pnl)} KRW</span>
        </div>)}
      </div>}
    </div>
    <Text className="results-caption" size="xs">
      Candles and Lorentzian kernel · Prediction · Strategy equity (mark to market) · KST
    </Text>
    <FitAll chart={handle} trigger={fitAll} />
  </>;
}
function FitAll({ chart, trigger }: {
  chart: React.RefObject<ChartHandle | null>; trigger: number;
}) {
  useEffect(() => {
    if (trigger > 0) chart.current?.chart.timeScale().fitContent();
  }, [chart, trigger]);
  return null;
}

export function ResultsPanel() {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [infos, setInfos] = useState<StrategyInfo[]>([]);
  const [strategies, setStrategies] = useState<Record<string, Strategy>>({});
  const [enabled, setEnabled] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void getJson<{ files: string[] }>("/api/results", controller.signal)
      .then((data) => {
        setFiles(data.files);
        setSelectedFile((current) => current && data.files.includes(current)
          ? current : (data.files[0] ?? null));
        setRequest((n) => n + 1);
      }).catch((cause) => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!selectedFile) { setResult(null); setInfos([]); setStrategies({}); return; }
    const controller = new AbortController();
    const query = encodeURIComponent(selectedFile);
    setResult(null); setInfos([]); setStrategies({}); setEnabled([]);
    setLoading(true); setError(null);
    void Promise.all([
      getJson<Result>(`/api/results/${query}?limit=10000`, controller.signal),
      getJson<{ strategies: StrategyInfo[] }>(`/api/strategies?result=${query}`, controller.signal),
    ]).then(async ([data, catalog]) => {
      const settled = await Promise.allSettled(catalog.strategies.map((info) =>
        getJson<Strategy>(`/api/strategies/${encodeURIComponent(info.id)}?result=${query}`, controller.signal)));
      if (controller.signal.aborted) return;
      const usable: StrategyInfo[] = [];
      const loaded: Record<string, Strategy> = {};
      const issues: string[] = [];
      settled.forEach((entry, index) => {
        const info = catalog.strategies[index];
        if (entry.status === "fulfilled" && entry.value.equity.length === data.bars.length
            && entry.value.equity.every((point, i) => point.time === data.bars[i].time)) {
          usable.push(info);
          loaded[info.id] = entry.value;
        } else { issues.push(info.id); }
      });
      setResult(data); setInfos(usable); setStrategies(loaded);
      setEnabled(usable.map((info) => info.id));
      if (issues.length) setError(`Strategy data did not match these candles: ${issues.join(", ")}`);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(String(cause));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedFile, request]);

  return <section className="results-panel">
    <Group justify="space-between" align="end" mb="lg">
      <Select label="RESULT FILE" placeholder="Select a CSV" searchable
        data={files} value={selectedFile} onChange={setSelectedFile}
        className="results-file-select" />
      <Button variant="light" onClick={() => setReload((n) => n + 1)}>Refresh files</Button>
    </Group>
    {error && <Alert color="red" mb="md">{error}</Alert>}
    {!loading && files.length === 0 && <Text c="dimmed">No CSV files found in result/.</Text>}
    {loading && <Text c="dimmed">Loading chart and strategies...</Text>}
    {result && !loading && <>
      <Text size="xs" c="dimmed" mb="sm">
        {result.filename} · {result.bars.length.toLocaleString()} candles
      </Text>
      <div className="results-strategies">
        <Text size="xs" fw={700}>STRATEGY OVERLAYS</Text>
        {infos.length ? <Group gap="lg" mt="xs">
          {infos.map((info, index) => <Checkbox key={info.id}
            label={`${info.name} · ${info.returnPct.toFixed(2)}% · ${info.completedTrades} trades`}
            color="cyan" checked={enabled.includes(info.id)}
            styles={{ label: { color: COLORS[index % COLORS.length] } }}
            onChange={(event) => setEnabled((current) => event.currentTarget.checked
              ? [...current, info.id] : current.filter((id) => id !== info.id))} />)}
        </Group> : <Text c="dimmed" size="xs" mt="xs">No matching backtests. Add backtest/&lt;strategy&gt;/ files.</Text>}
        {infos.length > 0 && <Text c="dimmed" size="xs" mt="xs">
          Returns include each strategy's configured fees and slippage; hover an exit candle for net trade details.
        </Text>}
      </div>
      {result.bars.length > 0 && <ResultChart result={result} infos={infos}
        strategies={strategies} enabled={enabled} />}
    </>}
  </section>;
}
