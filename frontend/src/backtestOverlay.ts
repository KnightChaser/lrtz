import {
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

export type ClosedTrade = {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  returnPct: number;
};

export type BacktestData = {
  summary: {
    source_csv: string;
    fee_bps: string;
    slippage_bps: string;
    return_pct: string;
    completed_trades: number;
  };
  fills: Array<{
    id: string;
    time: number;
    side: "BUY" | "SELL";
    price: number;
    quantity: number;
  }>;
  trades: ClosedTrade[];
  equity: Array<{ time: number; value: number }>;
};

export async function fetchBacktest(
  filename: string,
  signal: AbortSignal,
): Promise<BacktestData | null> {
  const response = await fetch(
    `/api/backtest/baseline?result=${encodeURIComponent(filename)}`,
    { signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<BacktestData>;
}

export function attachBacktestOverlay(
  chart: IChartApi,
  candles: ISeriesApi<"Candlestick">,
  container: HTMLElement,
  candleTimes: number[],
  data: BacktestData,
): () => void {
  const times = new Set(candleTimes);
  const returns = chart.addSeries(LineSeries, {
    title: "RETURN",
    color: "#67dbd0",
    lineWidth: 2,
    priceLineVisible: false,
    priceFormat: {
      type: "custom",
      minMove: 0.01,
      formatter: (value: number) => `${value.toFixed(2)}%`,
    },
  }, 2);
  returns.setData(data.equity.filter((point) => times.has(point.time)).map(
    (point) => ({ ...point, time: point.time as UTCTimestamp }),
  ));
  returns.createPriceLine({
    price: 0, color: "#728693", lineWidth: 1,
    lineStyle: LineStyle.Dashed, axisLabelVisible: false,
  });

  const byExit = new Map(data.trades.map((trade) => [trade.exitTime, trade]));
  const byId = new Map<string, ClosedTrade>();
  const markers: SeriesMarker<UTCTimestamp>[] = data.fills
    .filter((fill) => times.has(fill.time))
    .map((fill) => {
      const trade = fill.side === "SELL" ? byExit.get(fill.time) : undefined;
      if (trade) byId.set(fill.id, trade);
      return {
        id: fill.id,
        time: fill.time as UTCTimestamp,
        position: fill.side === "BUY" ? "belowBar" : "aboveBar",
        shape: fill.side === "BUY" ? "arrowUp" : "arrowDown",
        color: fill.side === "BUY" ? "#67e1ce" : "#ff8490",
        text: fill.side === "BUY" ? "BUY FILL" : "SELL FILL",
      };
    });
  const plugin = createSeriesMarkers(candles, markers);
  const tooltip = document.createElement("div");
  tooltip.className = "trade-tooltip";
  tooltip.setAttribute("role", "tooltip");
  container.appendChild(tooltip);
  const money = (value: number) => `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })} KRW`;
  const date = (value: number) => new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value * 1000));
  const hide = () => { tooltip.hidden = true; };
  hide();

  const onMove = (event: MouseEventParams<Time>) => {
    const id = event.hoveredInfo?.objectId ?? event.hoveredObjectId;
    const trade = typeof id === "string" ? byId.get(id) : undefined;
    if (!trade || !event.point) { hide(); return; }
    tooltip.textContent = [
      "CLOSED TRADE · NET OF FEES",
      `Entry  ${date(trade.entryTime)} KST`,
      `Exit   ${date(trade.exitTime)} KST`,
      `Entry price  ${money(trade.entryPrice)}`,
      `Exit price   ${money(trade.exitPrice)}`,
      `Return       ${trade.returnPct.toFixed(2)}%`,
      `PnL          ${money(trade.pnl)}`,
      "Fill prices include slippage.",
    ].join("\n");
    tooltip.dataset.outcome = trade.pnl >= 0 ? "profit" : "loss";
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(4, Math.min(
      event.point.x + 16, container.clientWidth - tooltip.offsetWidth - 8,
    ))}px`;
    tooltip.style.top = `${Math.max(4, Math.min(
      event.point.y + 16, container.clientHeight - tooltip.offsetHeight - 8,
    ))}px`;
  };
  chart.subscribeCrosshairMove(onMove);
  chart.timeScale().subscribeVisibleLogicalRangeChange(hide);
  container.addEventListener("mouseleave", hide);
  chart.panes()[0].setStretchFactor(0.58);
  chart.panes()[1].setStretchFactor(0.18);
  chart.panes()[2].setStretchFactor(0.24);

  return () => {
    chart.unsubscribeCrosshairMove(onMove);
    chart.timeScale().unsubscribeVisibleLogicalRangeChange(hide);
    container.removeEventListener("mouseleave", hide);
    plugin.detach();
    chart.removeSeries(returns);
    tooltip.remove();
  };
}
