export interface Quote {
  ticker: string;
  price: number | null;
  pct: number | null;
}

export interface PremarketQuote extends Quote {
  prev_close: number | null;
  time: string | null;
}

export interface PortfolioRow {
  ticker: string;
  shares: number;
  avg_cost: number;
  price: number | null;
  pct: number | null;
  prev_close: number | null;
  per_share: number | null;
  today_gain: number | null;
  unreal_gain: number | null;
  unreal_pct: number | null;
  day_high: number | null;
  day_low: number | null;
  volume: number | null;
}

export interface PremarketPortfolioRow {
  ticker: string;
  shares: number;
  close: number | null;
  pm_price: number | null;
  pm_time: string | null;
  ah_change: number | null;
  ah_pct: number | null;
  ah_gain: number | null;
}

export interface Position {
  shares: number;
  avg_cost: number;
  total_cost?: number;
}

export interface Account {
  currency: "USD" | "TWD";
  positions: Record<string, Position>;
}

export type Portfolio = Record<string, Account>;
export type Groups = Record<string, string[]>;

export type MarketStatus = "OPEN" | "PRE/POST" | "CLOSED";

export type SortDir = "asc" | "desc";
export interface SortState {
  col: keyof PortfolioRow | null;
  dir: SortDir;
}
