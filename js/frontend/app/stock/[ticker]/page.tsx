"use client";
import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea, CartesianGrid,
} from "recharts";
import { api } from "@/lib/api";

type Period = "intra" | "1d" | "2d" | "3d" | "4d" | "5d" | "1w" | "1m" | "3m" | "ytd" | "1y" | "5y" | "all";
type Bar = { t: number; o: number | null; h: number | null; l: number | null; c: number | null; v: number | null };
type SessionBoundary = { open: number; close?: number };

const PERIODS: { key: Period; label: string }[] = [
  { key: "intra", label: "盤中" },
  { key: "1d", label: "1日" }, { key: "2d", label: "2日" },
  { key: "3d", label: "3日" }, { key: "4d", label: "4日" }, { key: "5d", label: "5日" },
  { key: "1w", label: "1週" }, { key: "1m", label: "1月" }, { key: "3m", label: "3月" },
  { key: "ytd", label: "YTD" }, { key: "1y", label: "1年" }, { key: "5y", label: "5年" },
  { key: "all", label: "全部" },
];

function fmtTradingDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

function fmtDate(t: number, interval: string): string {
  const d = new Date(t);
  if (interval === "1m") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (interval === "15m") return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  if (interval === "1wk" || interval === "1mo") return `${d.getFullYear()}/${d.getMonth() + 1}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDateFull(t: number, interval: string): string {
  const d = new Date(t);
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  if (interval === "1m" || interval === "15m")
    return `${date} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  if (interval === "1wk" || interval === "1mo") return `${d.getFullYear()}/${d.getMonth() + 1}`;
  return date;
}

export default function StockPage() {
  const params = useParams();
  const ticker = (params?.ticker as string ?? "").toUpperCase();
  const [period, setPeriod] = useState<Period>("1d");
  const [intraDates, setIntraDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [data, setData] = useState<{
    bars: Bar[];
    interval: string;
    session_boundaries?: SessionBoundary[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch the 10 most recent trading days when intra mode is active
  useEffect(() => {
    if (period !== "intra") return;
    const market = /^\d{4,}$/.test(ticker) ? "TW" : "US";
    api.tradingDays(10, market).then(r => {
      setIntraDates(r.days);
      setSelectedDate(prev => (r.days.includes(prev) ? prev : r.days[0] ?? ""));
    }).catch(() => {});
  }, [period, ticker]);

  useEffect(() => {
    if (period === "intra" && !selectedDate) return;
    let cancelled = false;
    setLoading(true);
    api.history(ticker, period, period === "intra" ? selectedDate : undefined)
      .then(result => {
        if (cancelled) return;
        if (result && typeof result === "object" && "bars" in result) {
          setData({ bars: result.bars, interval: result.interval, session_boundaries: result.session_boundaries });
        } else {
          setData({ bars: [], interval: "1d" });
        }
      })
      .catch(() => { if (!cancelled) setData({ bars: [], interval: "1d" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, period, selectedDate]);

  const bars = data?.bars ?? [];
  const interval = data?.interval ?? "1d";
  const sessionBoundaries: SessionBoundary[] = data?.session_boundaries ?? [];
  const closes = bars.map(b => b.c).filter((c): c is number => c !== null);
  const first = closes[0] ?? 0;
  const last = closes[closes.length - 1] ?? 0;
  const change = last - first;
  const changePct = first ? change / first * 100 : 0;
  const isPos = change >= 0;
  const lineColor = isPos ? "#C05640" : "#3DAA70";


  const chartData = bars.map(b => ({
    t: b.t, c: b.c,
    gain: b.c !== null && b.c >= first ? b.c : first,
    loss: b.c !== null && b.c < first  ? b.c : first,
    v: b.v,
  }));

  // Compute non-session (pre/post market) shaded zones for rendering
  const isSingleDay = sessionBoundaries.length === 1;
  const nonSessionZones: { x1: number; x2: number; label?: string }[] = [];
  if (chartData.length > 0 && sessionBoundaries.length > 0) {
    const cStart = chartData[0].t;
    const cEnd = chartData[chartData.length - 1].t;
    if (sessionBoundaries[0].open > cStart)
      nonSessionZones.push({ x1: cStart, x2: sessionBoundaries[0].open, label: isSingleDay ? "盤前" : undefined });
    for (let i = 0; i < sessionBoundaries.length - 1; i++) {
      const c = sessionBoundaries[i].close;
      if (c != null) nonSessionZones.push({ x1: c, x2: sessionBoundaries[i + 1].open });
    }
    const lc = sessionBoundaries[sessionBoundaries.length - 1].close;
    if (lc != null && lc < cEnd)
      nonSessionZones.push({ x1: lc, x2: cEnd, label: isSingleDay ? "盤後" : undefined });
  }

  return (
    <div style={{ padding: "1rem 2rem", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Link href="/" style={{ color: "var(--dim)", fontFamily: "Courier New", fontSize: "0.8rem", textDecoration: "none" }}>
          ← 返回
        </Link>
        <span style={{ color: "var(--teal)", fontFamily: "Courier New", fontSize: "1.4rem", fontWeight: 700, letterSpacing: "0.1em" }}>
          {ticker}
        </span>
        {!loading && closes.length > 0 && (
          <>
            <span style={{ fontFamily: "Courier New", fontSize: "1.1rem", color: "var(--text)" }}>
              {last.toFixed(2)}
            </span>
            <span style={{ fontFamily: "Courier New", fontSize: "0.9rem", color: isPos ? "#C05640" : "#3DAA70" }}>
              {change >= 0 ? "+" : ""}{change.toFixed(2)} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
            </span>
          </>
        )}
      </div>

      {/* Period selector */}
      <div style={{ display: "flex", gap: 4, marginBottom: period === "intra" ? 8 : 16, flexWrap: "wrap" }}>
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            style={{
              padding: "4px 12px", fontFamily: "Courier New", fontSize: "0.78rem", fontWeight: 700,
              border: `1px solid ${period === p.key ? "var(--teal)" : "rgba(8,120,164,0.35)"}`,
              borderRadius: 4,
              background: period === p.key ? "rgba(30,207,214,0.12)" : "transparent",
              color: period === p.key ? "var(--teal)" : "var(--dim)", cursor: "pointer",
            }}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Intra date selector */}
      {period === "intra" && (
        <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
          {intraDates.length === 0
            ? <span style={{ color: "var(--dim)", fontFamily: "Courier New", fontSize: "0.75rem" }}>載入交易日…</span>
            : intraDates.map(d => (
                <button key={d} onClick={() => setSelectedDate(d)}
                  style={{
                    padding: "3px 10px", fontFamily: "Courier New", fontSize: "0.75rem", fontWeight: 700,
                    border: `1px solid ${selectedDate === d ? "var(--gold)" : "rgba(8,120,164,0.35)"}`,
                    borderRadius: 4,
                    background: selectedDate === d ? "rgba(237,209,112,0.12)" : "transparent",
                    color: selectedDate === d ? "var(--gold)" : "var(--dim)", cursor: "pointer",
                  }}>
                  {fmtTradingDate(d)}
                </button>
              ))
          }
        </div>
      )}

      {loading && <div style={{ color: "var(--dim)", fontFamily: "Courier New", padding: 40 }}>載入中… <span className="spinner" /></div>}

      {!loading && bars.length === 0 && !(period === "intra" && !selectedDate) && (
        <div style={{ color: "var(--dim)", fontFamily: "Courier New", padding: 40 }}>無法取得 {ticker} 的歷史資料</div>
      )}

      {!loading && bars.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(8,120,164,0.12)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]}
                tick={{ fill: "#6899b8", fontSize: 10 }} tickFormatter={t => fmtDate(t, interval)}
                tickCount={8} />
              <YAxis domain={["auto", "auto"]} tick={{ fill: "#6899b8", fontSize: 10 }}
                tickFormatter={v => v.toFixed(2)} width={60} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const price = payload[0].value as number;
                  const diff = price - first;
                  const pct = first ? diff / first * 100 : 0;
                  const clr = diff >= 0 ? "#C05640" : "#3DAA70";
                  const sign = diff >= 0 ? "+" : "";
                  const row = { display: "flex", justifyContent: "space-between", gap: 16 };
                  return (
                    <div style={{ background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)", fontFamily: "Courier New", fontSize: 12, padding: "6px 10px", lineHeight: 1.7 }}>
                      <div style={{ color: "#1ECFD6", marginBottom: 2 }}>{fmtDateFull(label as number, interval)}</div>
                      <div style={row}>
                        <span style={{ color: "#6899b8" }}>價格</span>
                        <span style={{ color: "#d4eaf5" }}>{price.toFixed(2)}</span>
                      </div>
                      <div style={row}>
                        <span style={{ color: "#6899b8" }}>漲跌</span>
                        <span style={{ color: clr }}>{sign}{diff.toFixed(2)}</span>
                      </div>
                      <div style={row}>
                        <span style={{ color: "#6899b8" }}>漲幅</span>
                        <span style={{ color: clr }}>{sign}{pct.toFixed(2)}%</span>
                      </div>
                    </div>
                  );
                }}
              />
              {/* Pre/post market shading */}
              {nonSessionZones.map((z, i) => (
                <ReferenceArea key={`zone-${i}`} x1={z.x1} x2={z.x2} fill="rgba(237,209,112,0.07)"
                  label={z.label ? { value: z.label, position: "insideTopLeft", fontSize: 9, fill: "rgba(237,209,112,0.55)" } : undefined} />
              ))}
              {/* Session open/close lines (labels only for single-day) */}
              {sessionBoundaries.map((sb, i) => (
                <React.Fragment key={`sb-${i}`}>
                  <ReferenceLine x={sb.open} stroke="rgba(30,207,214,0.28)" strokeDasharray="3 3"
                    label={isSingleDay ? { value: "開盤", position: "insideTopRight", fontSize: 9, fill: "rgba(30,207,214,0.6)" } : undefined} />
                  {sb.close != null && (
                    <ReferenceLine x={sb.close} stroke="rgba(30,207,214,0.28)" strokeDasharray="3 3"
                      label={isSingleDay ? { value: "收盤", position: "insideTopRight", fontSize: 9, fill: "rgba(30,207,214,0.6)" } : undefined} />
                  )}
                </React.Fragment>
              ))}
              <ReferenceLine y={first} stroke="rgba(8,120,164,0.3)" strokeDasharray="4 2" />
              <Area type="monotone" dataKey="c" stroke={lineColor} strokeWidth={2}
                fill={isPos ? "rgba(192,86,64,0.10)" : "rgba(61,170,112,0.10)"}
                dot={false} activeDot={{ r: 4, fill: lineColor }} />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Volume chart */}
          {bars.some(b => b.v !== null) && (
            <ResponsiveContainer width="100%" height={80}>
              <ComposedChart data={chartData} margin={{ top: 0, right: 16, bottom: 8, left: 8 }}>
                <XAxis dataKey="t" hide />
                <YAxis tick={{ fill: "#6899b8", fontSize: 9 }} width={60}
                  tickFormatter={v => v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)} />
                <Tooltip
                  contentStyle={{ background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)", fontFamily: "Courier New", fontSize: 11 }}
                  labelStyle={{ color: "#1ECFD6" }}
                  labelFormatter={t => fmtDate(t as number, interval)}
                  formatter={(v: unknown) => {
                    const n = v as number;
                    return [n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n), "成交量"];
                  }}
                />
                <Bar dataKey="v" fill="rgba(30,207,214,0.35)" radius={[1, 1, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  );
}
