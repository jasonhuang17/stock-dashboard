import type { Quote, PremarketQuote, PortfolioRow, PremarketPortfolioRow, Position, Portfolio, Groups, MarketStatus, Market, AccountGroup } from "./types";

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

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  return res.json();
}

export const api = {
  marketStatus: () =>
    get<{ status: MarketStatus; time: string; us: { status: MarketStatus; time: string }; tw: { status: MarketStatus; time: string } }>("/api/market-status"),

  quotes: (tickers: string[], market: Market = "US") =>
    get<Quote[]>(`/api/quotes?tickers=${tickers.join(",")}&market=${market}`),

  premarket: (tickers: string[]) =>
    get<PremarketQuote[]>(`/api/premarket?tickers=${tickers.join(",")}`),

  groups: () =>
    get<{ groups: Groups; pinned: string[]; markets: Record<string, Market> }>("/api/groups"),

  createGroup: (name: string, market: Market = "US") =>
    post<{ groups: Groups; pinned: string[]; markets: Record<string, Market> }>("/api/groups", { name, market }),

  deleteGroup: (name: string) =>
    del<{ groups: Groups; pinned: string[]; markets: Record<string, Market> }>(`/api/groups/${encodeURIComponent(name)}`),

  renameGroup: (name: string, newName: string) =>
    patch<{ groups: Groups; pinned: string[]; markets: Record<string, Market> }>(`/api/groups/${encodeURIComponent(name)}`, { name: newName }),

  reorderGroups: (order: string[]) =>
    put<{ groups: Groups; pinned: string[]; markets: Record<string, Market> }>("/api/groups/order", { order }),

  toggleGroupPin: (group: string) =>
    put<{ groups: Groups; pinned: string[]; markets: Record<string, Market> }>(`/api/groups/${encodeURIComponent(group)}/pin`, {}),

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

  twSearch: (q: string) =>
    get<{ code: string; name: string }[]>(`/api/tw-search?q=${encodeURIComponent(q)}`),

  usSearch: (q: string) =>
    get<{ code: string; name: string }[]>(`/api/us-search?q=${encodeURIComponent(q)}`),

  getSettings: () =>
    get<{ use_mock: boolean; col_vis?: string[]; col_order?: string[]; pnl_cols?: Record<string, { vis: string[]; order: string[]; dividers?: string[] }>; protected_accounts?: string[]; theme?: string; crypto_sort?: { col: string; dir: "asc" | "desc" }; group_sorts?: Record<string, string>; crypto_tickers?: string[]; account_groups?: AccountGroup[] }>("/api/settings"),

  setSettings: (patch: { use_mock?: boolean; col_vis?: string[]; col_order?: string[]; pnl_cols?: Record<string, { vis: string[]; order: string[]; dividers?: string[] }>; protected_accounts?: string[]; theme?: string; crypto_sort?: { col: string; dir: "asc" | "desc" }; group_sorts?: Record<string, string>; crypto_tickers?: string[]; account_groups?: AccountGroup[] }) =>
    put<{ use_mock: boolean }>("/api/settings", patch),

  validateCrypto: (ticker: string) =>
    get<{ valid: boolean; ticker: string }>(`/api/validate/crypto/${encodeURIComponent(ticker)}`),

  // Account CRUD
  createAccount: (name: string, currency: "USD" | "TWD") =>
    post<{ accounts: string[]; account: string; currency: string }>("/api/portfolio/accounts", { name, currency }),

  renameAccount: (account: string, new_name: string) =>
    put<{ accounts: string[] }>(`/api/portfolio/accounts/${encodeURIComponent(account)}/rename`, { new_name }),

  deleteAccount: (account: string) =>
    del<{ accounts: string[] }>(`/api/portfolio/accounts/${encodeURIComponent(account)}`),

  reorderAccounts: (order: string[]) =>
    put<{ accounts: string[] }>("/api/portfolio/accounts/order", { order }),

  // History (K-line)
  history: (ticker: string, period: string, date?: string) =>
    get<{
      ticker: string; period: string; interval: string;
      bars: { t: number; o: number | null; h: number | null; l: number | null; c: number | null; v: number | null }[];
      session_boundaries?: { open: number; close?: number }[];
    }>(`/api/history/${encodeURIComponent(ticker)}?period=${period}${date ? `&date=${date}` : ""}`),

  tradingDays: (count = 10, market: Market = "US") =>
    get<{ days: string[] }>(`/api/trading-days?count=${count}&market=${market}`),

  // Market overview
  marketOverview: () =>
    get<{
      gainers: { ticker: string; name: string; price: number; pct: number; volume: number | null }[];
      losers:  { ticker: string; name: string; price: number; pct: number; volume: number | null }[];
      actives: { ticker: string; name: string; price: number; pct: number; volume: number | null }[];
    }>("/api/market/overview"),

  twMarketOverview: () =>
    get<{ stocks: { ticker: string; name: string; price: number; pct: number; volume: number | null }[] }>("/api/market/tw-overview"),

  // Crypto
  cryptoQuotes: () =>
    get<{ coins: { ticker: string; price: number; pct: number; volume: number | null }[] }>("/api/crypto/quotes"),
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
