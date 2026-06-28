"use client";
import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type Stock = { ticker: string; name?: string; price: number; pct: number; volume: number | null };
type Sort = "pct_desc" | "pct_asc" | "volume_desc";

function colorOf(v: number) { return v >= 0 ? "#C05640" : "#3DAA70"; }
function fmtPct(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }
function fmtVol(v: number | null) {
  if (v === null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

function sortStocks(stocks: Stock[], sort: Sort): Stock[] {
  return [...stocks].sort((a, b) => {
    if (sort === "pct_desc") return b.pct - a.pct;
    if (sort === "pct_asc")  return a.pct - b.pct;
    return (b.volume ?? 0) - (a.volume ?? 0);
  });
}

function StockRow({ s }: { s: Stock }) {
  return (
    <tr>
      <td style={{ textAlign: "left" }}>
        <Link href={`/stock/${encodeURIComponent(s.ticker)}`}
          style={{ color: "var(--teal)", fontWeight: 700, textDecoration: "none", fontFamily: "Courier New" }}>
          {s.ticker}
        </Link>
        {s.name && <div style={{ color: "var(--dim)", fontSize: "0.68rem" }}>{s.name}</div>}
      </td>
      <td>${s.price.toFixed(2)}</td>
      <td style={{ color: colorOf(s.pct), fontWeight: 700 }}>{fmtPct(s.pct)}</td>
      <td style={{ color: "var(--dim)" }}>{fmtVol(s.volume)}</td>
    </tr>
  );
}

export function MarketTab({ refreshKey }: { refreshKey: number }) {
  const [usData, setUsData] = useState<{ gainers: Stock[]; losers: Stock[]; actives: Stock[] }>({ gainers: [], losers: [], actives: [] });
  const [twStocks, setTwStocks] = useState<Stock[]>([]);
  const [marketTab, setMarketTab] = useState<"us" | "tw">("us");
  const [sort, setSort] = useState<Sort>("pct_desc");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [us, tw] = await Promise.all([api.marketOverview(), api.twMarketOverview()]);
      setUsData(us);
      setTwStocks(tw.stocks);
    } catch { /* silent */ }
    setLoading(false);
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const SORTS: { key: Sort; label: string }[] = [
    { key: "pct_desc", label: "漲幅↓" },
    { key: "pct_asc",  label: "跌幅↓" },
    { key: "volume_desc", label: "成交量↓" },
  ];

  const miniTable = (label: string, rows: Stock[]) => (
    <div style={{ flex: "1 1 280px", minWidth: 240 }}>
      <div style={{ color: "var(--gold)", fontFamily: "Courier New", fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8, borderLeft: "3px solid rgba(237,209,112,0.4)", paddingLeft: 8 }}>
        {label}
      </div>
      <table className="pnl-table" style={{ width: "100%" }}>
        <thead><tr><th style={{ textAlign: "left" }}>代號</th><th>現價</th><th>漲跌%</th><th>成交量</th></tr></thead>
        <tbody>{rows.map(s => <StockRow key={s.ticker} s={s} />)}</tbody>
      </table>
    </div>
  );

  if (loading) return <div style={{ padding: 20, color: "var(--dim)" }}>載入中… <span className="spinner" /></div>;

  return (
    <div>
      {/* Market tabs: US / TW */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {(["us", "tw"] as const).map(m => (
          <button key={m} onClick={() => setMarketTab(m)}
            className={`tab-btn${marketTab === m ? " active" : ""}`}>
            {m === "us" ? "🇺🇸 美股" : "🇹🇼 台股"}
          </button>
        ))}
        {marketTab === "tw" && (
          <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {SORTS.map(s => (
              <button key={s.key} onClick={() => setSort(s.key)}
                style={{ padding: "3px 10px", fontFamily: "Courier New", fontSize: "0.72rem", fontWeight: 700,
                  border: `1px solid ${sort === s.key ? "var(--teal)" : "rgba(8,120,164,0.35)"}`,
                  borderRadius: 4, background: sort === s.key ? "rgba(30,207,214,0.12)" : "transparent",
                  color: sort === s.key ? "var(--teal)" : "var(--dim)", cursor: "pointer" }}>
                {s.label}
              </button>
            ))}
          </span>
        )}
      </div>

      {marketTab === "us" ? (
        /* US: screener-based 3 categories */
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {miniTable("漲幅排行", usData.gainers)}
          {miniTable("跌幅排行", usData.losers)}
          {miniTable("成交量排行", usData.actives)}
        </div>
      ) : (
        /* TW: mini summary + full sorted table */
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
            {miniTable("漲幅排行", sortStocks(twStocks, "pct_desc").slice(0, 5))}
            {miniTable("跌幅排行", sortStocks(twStocks, "pct_asc").slice(0, 5))}
            {miniTable("成交量排行", sortStocks(twStocks, "volume_desc").slice(0, 5))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="pnl-table" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>代號</th>
                  <th>現價</th>
                  <th>漲跌%</th>
                  <th>成交量</th>
                </tr>
              </thead>
              <tbody>
                {sortStocks(twStocks, sort).map(s => <StockRow key={s.ticker} s={s} />)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
