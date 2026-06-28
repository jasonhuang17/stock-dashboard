"use client";
import React, { useState, useEffect, useCallback } from "react";
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

type SortCol = "pct" | "price" | "volume";
type SortState = { col: SortCol; dir: "asc" | "desc" };

export function CryptoTab({ refreshKey }: { refreshKey: number }) {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [sort, setSort] = useState<SortState>({ col: "pct", dir: "desc" });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.cryptoQuotes();
      setCoins(res.coins);
    } catch { /* silent */ }
    setLoading(false);
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  function onHeaderClick(col: SortCol) {
    setSort(prev => prev.col === col
      ? { col, dir: prev.dir === "desc" ? "asc" : "desc" }
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "Courier New", fontSize: "0.78rem", color: "var(--dim)", letterSpacing: "0.08em" }}>
          加密貨幣（via Yahoo Finance，資料延遲約 15 秒）
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {([
            [{ col: "pct",    dir: "desc" } as SortState, "漲幅↓"],
            [{ col: "pct",    dir: "asc"  } as SortState, "跌幅↓"],
            [{ col: "volume", dir: "desc" } as SortState, "成交量↓"],
          ] as const).map(([s, label]) => {
            const active = sort.col === s.col && sort.dir === s.dir;
            return (
              <button key={label} onClick={() => setSort(s)}
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
