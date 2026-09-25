/** A candle and its shared Lorentzian Classification output. */
export interface ResultBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  prediction: number;
  direction: number;
  kernel: number | null;
  buy: boolean;
  sell: boolean;
}

export interface ResultData {
  filename: string;
  bars: ResultBar[];
}

/** Metadata used to list and color a backtest. */
export interface StrategyInfo {
  id: string;
  name: string;
  returnPct: number;
  completedTrades: number;
  feeBps: number;
  slippageBps: number;
}

export interface Fill {
  time: number;
  side: "BUY" | "SELL";
  price: number;
}

export interface Trade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  pnl: number;
}

export interface StrategyData {
  id: string;
  fills: Fill[];
  trades: Trade[];
  equity: { time: number; returnPct: number }[];
}

export const STRATEGY_COLORS = [
  "#69d6c6",
  "#eaa9ff",
  "#ffca70",
  "#86afff",
  "#ff8591",
  "#b1de79",
];

export function formatKst(seconds: number): string {
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

export function formatPrice(value: number | null): string {
  if (value === null) return "—";

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}
