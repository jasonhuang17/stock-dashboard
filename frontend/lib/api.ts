import type { Quote, PremarketQuote, PortfolioRow, PremarketPortfolioRow, Position, Portfolio, Groups, MarketStatus } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  return res.json();
}

export const api = {
  marketStatus: () =>
    get<{ status: MarketStatus; time: string }>("/api/market-status"),

  quotes: (tickers: string[]) =>
    get<Quote[]>(`/api/quotes?tickers=${tickers.join(",")}`),

  premarket: (tickers: string[]) =>
    get<PremarketQuote[]>(`/api/premarket?tickers=${tickers.join(",")}`),

  groups: () => get<Groups>("/api/groups"),

  addGroupTicker: (group: string, ticker: string) =>
    post<{ tickers: string[] }>(`/api/groups/${encodeURIComponent(group)}/tickers`, { ticker }),

  removeGroupTicker: (group: string, ticker: string) =>
    del<{ tickers: string[] }>(`/api/groups/${encodeURIComponent(group)}/tickers/${encodeURIComponent(ticker)}`),

  reorderGroup: (group: string, order: string[]) =>
    put<{ tickers: string[] }>(`/api/groups/${encodeURIComponent(group)}/order`, { order }),

  portfolio: () => get<Portfolio>("/api/portfolio"),

  portfolioRows: (account: string) =>
    get<PortfolioRow[]>(`/api/portfolio/${encodeURIComponent(account)}/rows`),

  portfolioPremarketRows: (account: string) =>
    get<PremarketPortfolioRow[]>(`/api/portfolio/${encodeURIComponent(account)}/premarket-rows`),

  addPosition: (account: string, ticker: string, shares: number, avg_cost: number, total_cost?: number) =>
    post<Position>(`/api/portfolio/${encodeURIComponent(account)}/positions`, {
      ticker, shares, avg_cost, ...(total_cost !== undefined ? { total_cost } : {}),
    }),

  updatePosition: (account: string, ticker: string, shares: number, avg_cost: number, total_cost?: number) =>
    put<Position>(
      `/api/portfolio/${encodeURIComponent(account)}/positions/${encodeURIComponent(ticker)}`,
      { ticker, shares, avg_cost, ...(total_cost !== undefined ? { total_cost } : {}) },
    ),

  deletePosition: (account: string, ticker: string) =>
    del<{ ok: boolean }>(
      `/api/portfolio/${encodeURIComponent(account)}/positions/${encodeURIComponent(ticker)}`,
    ),

  reorderPortfolio: (account: string, order: string[]) =>
    put<{ order: string[] }>(
      `/api/portfolio/${encodeURIComponent(account)}/order`,
      { order },
    ),

  validateUS: (ticker: string) =>
    get<{ exists: boolean }>(`/api/validate/us/${encodeURIComponent(ticker)}`),

  validateTW: (ticker: string) =>
    get<{ exists: boolean; resolved: string | null }>(`/api/validate/tw/${encodeURIComponent(ticker)}`),

  getSettings: () =>
    get<{ use_mock: boolean }>("/api/settings"),

  setSettings: (use_mock: boolean) =>
    put<{ use_mock: boolean }>("/api/settings", { use_mock }),
};

// Convenience: format number with sign
export function fmt(n: number | null, decimals = 2, prefix = ""): string {
  if (n === null || n === undefined) return "—";
  return `${prefix}${n.toFixed(decimals)}`;
}

export function fmtMoney(n: number | null, currency: "USD" | "TWD" = "USD"): string {
  if (n === null || n === undefined) return "—";
  const sym = currency === "TWD" ? "NT$" : "$";
  return `${n < 0 ? "-" : ""}${sym}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
