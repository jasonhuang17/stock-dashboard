"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type Coin = { ticker: string; price: number; pct: number; volume: number | null };

function colorOf(v: number) { return v >= 0 ? "#C05640" : "#3DAA70"; }
function fmtPct(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }
function fmtVol(v: number | null) {
  if (v === null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return `${(v / 1e3).toFixed(0)}K`;
}

function displayName(ticker: string) {
  return ticker.replace(/-USD$/, "").replace(/-USDT$/, "");
}

const FULL_NAMES: Record<string, string> = {
  "BTC-USD": "Bitcoin",    "ETH-USD": "Ethereum",  "SOL-USD": "Solana",
  "BNB-USD": "BNB",        "XRP-USD": "XRP",        "ADA-USD": "Cardano",
  "AVAX-USD": "Avalanche", "DOGE-USD": "Dogecoin",  "DOT-USD": "Polkadot",
  "LINK-USD": "Chainlink", "MATIC-USD": "Polygon",  "UNI-USD": "Uniswap",
  "LTC-USD": "Litecoin",   "ATOM-USD": "Cosmos",    "FIL-USD": "Filecoin",
};

const DEFAULT_TICKERS = [
  "BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "XRP-USD",
  "ADA-USD", "AVAX-USD", "DOGE-USD", "DOT-USD", "LINK-USD",
  "MATIC-USD", "UNI-USD", "LTC-USD", "ATOM-USD", "FIL-USD",
];

type SortCol = "pct" | "price" | "volume";
type SortState = { col: SortCol; dir: "asc" | "desc" };

export function CryptoTab({ refreshKey }: { refreshKey: number }) {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [sort, setSort] = useState<SortState>({ col: "pct", dir: "desc" });
  const [loading, setLoading] = useState(true);
  const [tickers, setTickers] = useState<string[]>(DEFAULT_TICKERS);
  const [editOpen, setEditOpen] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getSettings().then(s => {
      if (s.crypto_sort) setSort({ col: s.crypto_sort.col as SortCol, dir: s.crypto_sort.dir });
      if (s.crypto_tickers?.length) setTickers(s.crypto_tickers);
    }).catch(() => {});
  }, []);

  function changeSort(next: SortState) {
    setSort(next);
    api.setSettings({ crypto_sort: { col: next.col, dir: next.dir } }).catch(() => {});
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.cryptoQuotes();
      setCoins(res.coins);
    } catch { /* silent */ }
    setLoading(false);
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    const raw = addInput.trim().toUpperCase();
    if (!raw) return;
    const t = raw.endsWith("-USD") || raw.endsWith("-USDT") ? raw : raw + "-USD";
    if (tickers.includes(t)) {
      setAddError("已在清單中");
      return;
    }
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await api.validateCrypto(t);
      if (!res.valid) {
        setAddError(`找不到 ${res.ticker}`);
        return;
      }
      const next = [...tickers, res.ticker];
      setTickers(next);
      setAddInput("");
      await api.setSettings({ crypto_tickers: next });
      await load();
    } catch {
      setAddError("驗證失敗，請稍後再試");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleRemove(ticker: string) {
    const next = tickers.filter(t => t !== ticker);
    if (next.length === 0) return;
    setTickers(next);
    await api.setSettings({ crypto_tickers: next });
    await load();
  }

  function onHeaderClick(col: SortCol) {
    changeSort(sort.col === col
      ? { col, dir: sort.dir === "desc" ? "asc" : "desc" }
      : { col, dir: "desc" });
  }

  function ind(col: SortCol) {
    if (sort.col !== col) return "";
    return sort.dir === "desc" ? " ↓" : " ↑";
  }

  const sorted = [...coins].sort((a, b) => {
    const mul = sort.dir === "desc" ? -1 : 1;
    if (sort.col === "pct")    return mul * (a.pct - b.pct);
    if (sort.col === "price")  return mul * (a.price - b.price);
    return mul * ((a.volume ?? 0) - (b.volume ?? 0));
  });

  if (loading) return <div style={{ padding: 20, color: "var(--dim)" }}>載入中… <span className="spinner" /></div>;

  return (
    <div>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: editOpen ? 12 : 16, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "Courier New", fontSize: "0.78rem", color: "var(--dim)", letterSpacing: "0.08em" }}>
          加密貨幣（via Yahoo Finance，資料延遲約 15 秒）
        </span>
        <button
          onClick={() => { setEditOpen(o => !o); setAddError(null); setAddInput(""); }}
          style={{
            padding: "3px 10px", fontFamily: "Courier New", fontSize: "0.72rem", fontWeight: 700,
            border: `1px solid ${editOpen ? "var(--teal)" : "rgba(8,120,164,0.35)"}`,
            borderRadius: 4,
            background: editOpen ? "rgba(30,207,214,0.12)" : "transparent",
            color: editOpen ? "var(--teal)" : "var(--dim)",
            cursor: "pointer",
          }}
        >
          {editOpen ? "▲ 收起" : "＋ 編輯清單"}
        </button>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {([
            [{ col: "pct",    dir: "desc" } as SortState, "漲幅↓"],
            [{ col: "pct",    dir: "asc"  } as SortState, "跌幅↓"],
            [{ col: "volume", dir: "desc" } as SortState, "成交量↓"],
          ] as const).map(([s, label]) => {
            const active = sort.col === s.col && sort.dir === s.dir;
            return (
              <button key={label} onClick={() => changeSort(s)}
                style={{ padding: "3px 10px", fontFamily: "Courier New", fontSize: "0.72rem", fontWeight: 700,
                  border: `1px solid ${active ? "var(--teal)" : "rgba(8,120,164,0.35)"}`,
                  borderRadius: 4, background: active ? "rgba(30,207,214,0.12)" : "transparent",
                  color: active ? "var(--teal)" : "var(--dim)", cursor: "pointer" }}>
                {label}
              </button>
            );
          })}
        </span>
      </div>

      {/* Edit panel */}
      {editOpen && (
        <div style={{
          background: "rgba(8,120,164,0.06)", border: "1px solid rgba(8,120,164,0.25)",
          borderRadius: 8, padding: "14px 16px", marginBottom: 16,
        }}>
          {/* Existing tickers as chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {tickers.map(t => (
              <span key={t} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: "rgba(30,207,214,0.1)", border: "1px solid rgba(30,207,214,0.3)",
                borderRadius: 4, padding: "2px 8px",
                fontFamily: "Courier New", fontSize: "0.75rem", color: "var(--teal)",
              }}>
                {displayName(t)}
                {tickers.length > 1 && (
                  <button
                    onClick={() => handleRemove(t)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--dim)", fontSize: "0.72rem", padding: 0, lineHeight: 1,
                    }}
                    title={`移除 ${displayName(t)}`}
                  >✕</button>
                )}
              </span>
            ))}
          </div>

          {/* Add new ticker */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              ref={inputRef}
              value={addInput}
              onChange={e => { setAddInput(e.target.value.toUpperCase()); setAddError(null); }}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              placeholder="輸入代號，如 BTC 或 ETH-USD"
              style={{
                background: "rgba(0,24,40,0.8)", border: "1px solid rgba(8,120,164,0.4)",
                borderRadius: 4, padding: "5px 10px",
                fontFamily: "Courier New", fontSize: "0.78rem", color: "var(--text)",
                width: 220, outline: "none",
              }}
            />
            <button
              onClick={handleAdd}
              disabled={addLoading || !addInput.trim()}
              style={{
                padding: "5px 14px", fontFamily: "Courier New", fontSize: "0.78rem", fontWeight: 700,
                border: "1px solid rgba(30,207,214,0.5)", borderRadius: 4,
                background: "rgba(30,207,214,0.12)", color: "var(--teal)",
                cursor: addLoading || !addInput.trim() ? "not-allowed" : "pointer",
                opacity: addLoading || !addInput.trim() ? 0.5 : 1,
              }}
            >
              {addLoading ? "驗證中…" : "新增"}
            </button>
          </div>
          {addError && (
            <div style={{ marginTop: 6, fontFamily: "Courier New", fontSize: "0.72rem", color: "#C05640" }}>
              {addError}
            </div>
          )}
          <div style={{ marginTop: 8, fontFamily: "Courier New", fontSize: "0.68rem", color: "var(--dim)" }}>
            支援 Yahoo Finance 格式：BTC、ETH-USD、PEPE-USD 等
          </div>
        </div>
      )}

      {/* Cards grid */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        {sorted.map(coin => (
          <Link key={coin.ticker} href={`/stock/${encodeURIComponent(coin.ticker)}`}
            style={{ textDecoration: "none", flex: "1 1 180px", minWidth: 160, maxWidth: 220 }}>
            <div style={{ background: "rgba(8,120,164,0.08)", border: "1px solid rgba(8,120,164,0.25)", borderRadius: 8, padding: "12px 14px", cursor: "pointer", transition: "border-color 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(30,207,214,0.5)")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(8,120,164,0.25)")}>
              <div style={{ fontFamily: "Courier New", fontSize: "0.9rem", fontWeight: 700, color: "var(--teal)", letterSpacing: "0.06em" }}>
                {displayName(coin.ticker)}
              </div>
              <div style={{ fontFamily: "Courier New", fontSize: "0.68rem", color: "var(--dim)", marginBottom: 8 }}>
                {FULL_NAMES[coin.ticker] ?? coin.ticker}
              </div>
              <div style={{ fontFamily: "Courier New", fontSize: "1.05rem", color: "var(--text)" }}>
                ${coin.price < 1 ? coin.price.toFixed(4) : coin.price < 100 ? coin.price.toFixed(2) : coin.price.toFixed(0)}
              </div>
              <div style={{ fontFamily: "Courier New", fontSize: "0.88rem", color: colorOf(coin.pct), fontWeight: 700 }}>
                {fmtPct(coin.pct)}
              </div>
              {coin.volume !== null && (
                <div style={{ fontFamily: "Courier New", fontSize: "0.68rem", color: "var(--dim)", marginTop: 4 }}>
                  vol: {fmtVol(coin.volume)}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>

      {/* Full table */}
      <div style={{ overflowX: "auto" }}>
        <table className="pnl-table" style={{ minWidth: 400 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>代號</th>
              <th style={{ cursor: "pointer" }} onClick={() => onHeaderClick("price")}>現價{ind("price")}</th>
              <th style={{ cursor: "pointer" }} onClick={() => onHeaderClick("pct")}>漲跌%{ind("pct")}</th>
              <th style={{ cursor: "pointer" }} onClick={() => onHeaderClick("volume")}>成交量{ind("volume")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(coin => (
              <tr key={coin.ticker}>
                <td style={{ textAlign: "left" }}>
                  <Link href={`/stock/${encodeURIComponent(coin.ticker)}`}
                    style={{ color: "var(--teal)", fontWeight: 700, textDecoration: "none", fontFamily: "Courier New" }}>
                    {displayName(coin.ticker)}
                  </Link>
                  <div style={{ color: "var(--dim)", fontSize: "0.68rem" }}>{FULL_NAMES[coin.ticker] ?? ""}</div>
                </td>
                <td>${coin.price < 1 ? coin.price.toFixed(4) : coin.price < 100 ? coin.price.toFixed(2) : coin.price.toFixed(0)}</td>
                <td style={{ color: colorOf(coin.pct), fontWeight: 700 }}>{fmtPct(coin.pct)}</td>
                <td style={{ color: "var(--dim)" }}>{fmtVol(coin.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
