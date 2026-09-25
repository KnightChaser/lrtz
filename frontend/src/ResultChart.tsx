import { useEffect, useRef, useState } from "react";
import { Button, Text } from "@mantine/core";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import {
  STRATEGY_COLORS,
  formatKst,
  formatPrice,
  type ResultBar,
  type ResultData,
  type StrategyData,
  type StrategyInfo,
  type Trade,
} from "./resultsTypes";

interface Props {
  result: ResultData;
  infos: StrategyInfo[];
  strategies: Record<string, StrategyData>;
  enabled: string[];
}

interface ChartHandle {
  chart: IChartApi;
  markers: ISeriesMarkersPluginApi<Time>;
  equityLines: Map<string, ISeriesApi<"Line">>;
}

interface ClosedTrade {
  id: string;
  trade: Trade;
}

function chartOptions() {
  return {
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
    rightPriceScale: { borderColor: "#29404c" },
    timeScale: {
      borderColor: "#29404c",
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time: Time) => formatKst(Number(time)),
    },
    localization: {
      timeFormatter: (time: Time) => formatKst(Number(time)),
    },
  };
}

function addIndicators(chart: IChartApi, bars: ResultBar[]) {
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
      priceFormat: { type: "price", precision: 0, minMove: 1 },
      priceLineVisible: false,
    },
    1,
  );

  candles.setData(
    bars.map((bar) => ({
      time: bar.time as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    })),
  );
  kernel.setData(
    bars
      .filter((bar) => bar.kernel !== null)
      .map((bar) => ({
        time: bar.time as UTCTimestamp,
        value: bar.kernel as number,
      })),
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
    })),
  );

  return createSeriesMarkers(candles, []);
}

function addSignalMarkers(markers: SeriesMarker<Time>[], bars: ResultBar[]) {
  for (const bar of bars) {
    if (bar.buy) {
      markers.push({
        time: bar.time as UTCTimestamp,
        position: "belowBar",
        color: "#67e1ce",
        shape: "arrowUp",
        text: "SIGNAL BUY",
      });
    }
    if (bar.sell) {
      markers.push({
        time: bar.time as UTCTimestamp,
        position: "aboveBar",
        color: "#ff8490",
        shape: "arrowDown",
        text: "SIGNAL SELL",
      });
    }
  }
}

/** Update only overlays when strategies are toggled, preserving the chart zoom. */
function updateOverlays(
  handle: ChartHandle,
  result: ResultData,
  infos: StrategyInfo[],
  strategies: Record<string, StrategyData>,
  enabled: string[],
): Map<number, ClosedTrade[]> {
  const visible = enabled.filter((id) => strategies[id] !== undefined);
  const candleTimes = new Set(result.bars.map((bar) => bar.time));
  const markers: SeriesMarker<Time>[] = [];
  const tradesByExit = new Map<number, ClosedTrade[]>();

  for (const id of visible) {
    const strategy = strategies[id];
    const colorIndex = infos.findIndex((info) => info.id === id);
    const color = STRATEGY_COLORS[colorIndex % STRATEGY_COLORS.length];

    let equityLine = handle.equityLines.get(id);
    if (!equityLine) {
      equityLine = handle.chart.addSeries(
        LineSeries,
        {
          color,
          lineWidth: 2,
          title: id,
          priceFormat: {
            type: "custom",
            minMove: 0.01,
            formatter: (value: number) => `${value.toFixed(2)}%`,
          },
        },
        2,
      );
      handle.equityLines.set(id, equityLine);
    }

    equityLine.setData(
      strategy.equity
        .filter((point) => candleTimes.has(point.time))
        .map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.returnPct,
        })),
    );

    for (const fill of strategy.fills) {
      if (!candleTimes.has(fill.time)) continue;
      markers.push({
        time: fill.time as UTCTimestamp,
        position: fill.side === "BUY" ? "belowBar" : "aboveBar",
        color,
        shape: fill.side === "BUY" ? "arrowUp" : "arrowDown",
        text: `${id} ${fill.side}`,
      });
    }

    for (const trade of strategy.trades) {
      if (!candleTimes.has(trade.exitTime)) continue;
      const closedAtThisTime = tradesByExit.get(trade.exitTime) ?? [];
      closedAtThisTime.push({ id, trade });
      tradesByExit.set(trade.exitTime, closedAtThisTime);
    }
  }

  for (const [id, line] of handle.equityLines) {
    if (visible.includes(id)) continue;
    handle.chart.removeSeries(line);
    handle.equityLines.delete(id);
  }

  // Keep source signals when no backtest exists. Strategy visibility controls
  // actual fills only; source indicators remain available for comparison.
  if (infos.length === 0) addSignalMarkers(markers, result.bars);

  markers.sort((first, second) => Number(first.time) - Number(second.time));
  handle.markers.setMarkers(markers);

  const panes = handle.chart.panes();
  panes[0]?.setStretchFactor(6);
  panes[1]?.setStretchFactor(2);
  panes[2]?.setStretchFactor(visible.length > 0 ? 3 : 0.01);

  return tradesByExit;
}

export function ResultChart({ result, infos, strategies, enabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartHandle | null>(null);
  const hoverLookup = useRef(new Map<number, ClosedTrade[]>());
  const [focused, setFocused] = useState<ResultBar | null>(
    result.bars.at(-1) ?? null,
  );
  const [hovered, setHovered] = useState<ClosedTrade[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || result.bars.length === 0) return;

    const chart = createChart(container, chartOptions());
    const markers = addIndicators(chart, result.bars);
    chartRef.current = { chart, markers, equityLines: new Map() };

    const barsByTime = new Map(result.bars.map((bar) => [bar.time, bar]));
    chart.subscribeCrosshairMove((event) => {
      if (event.time === undefined) {
        setHovered([]);
        return;
      }

      const time = Number(event.time);
      const bar = barsByTime.get(time);
      if (bar) setFocused(bar);
      setHovered(hoverLookup.current.get(time) ?? []);
    });
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, result.bars.length - 160),
      to: result.bars.length + 5,
    });

    return () => {
      chartRef.current = null;
      chart.remove();
    };
  }, [result]);

  useEffect(() => {
    if (!chartRef.current) return;
    hoverLookup.current = updateOverlays(
      chartRef.current,
      result,
      infos,
      strategies,
      enabled,
    );
    setHovered([]);
  }, [result, infos, strategies, enabled]);

  return (
    <>
      <div className="results-readout">
        {focused && (
          <>
            <span>{formatKst(focused.time)} KST</span>
            <span>O {formatPrice(focused.open)}</span>
            <span>H {formatPrice(focused.high)}</span>
            <span>L {formatPrice(focused.low)}</span>
            <span>C {formatPrice(focused.close)}</span>
            <span>Prediction {focused.prediction}</span>
            <span>Direction {focused.direction}</span>
            <span>Kernel {formatPrice(focused.kernel)}</span>
          </>
        )}
        <Button
          size="xs"
          variant="subtle"
          onClick={() => chartRef.current?.chart.timeScale().fitContent()}
        >
          Fit all candles
        </Button>
      </div>

      <div className="results-chart-wrap">
        <div className="results-chart" ref={containerRef} />
        {hovered.length > 0 && (
          <div className="results-trade-tooltip">
            {hovered.map(({ id, trade }) => (
              <div key={`${id}-${trade.exitTime}`}>
                <strong>{id} · CLOSED TRADE</strong>
                <span>
                  Entry: {formatKst(trade.entryTime)} KST ·{" "}
                  {formatPrice(trade.entryPrice)} KRW
                </span>
                <span>
                  Exit: {formatKst(trade.exitTime)} KST ·{" "}
                  {formatPrice(trade.exitPrice)} KRW
                </span>
                <span>
                  Net return: {trade.returnPct.toFixed(2)}% · PnL:{" "}
                  {formatPrice(trade.pnl)} KRW
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Text className="results-caption" size="xs">
        Candles and Lorentzian kernel · Prediction · Strategy equity (mark to
        market) · KST
      </Text>
    </>
  );
}
