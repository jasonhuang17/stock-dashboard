"use client";
import React, { useState, useEffect, useRef } from "react";
import type { PortfolioRow, SortState } from "@/lib/types";
import { fmtMoney, fmtPct } from "@/lib/api";

type Currency = "USD" | "TWD";
type Col = keyof PortfolioRow;

interface ColDef {
  key: Col;
  label: string;
  fmt: (row: PortfolioRow) => string;
}

const REQUIRED_COLS = new Set(["ticker", "today_gain", "unreal_gain"]);

const VIS_KEY   = "pnl-cols-v2";
const ORDER_KEY = "pnl-cols-order";

type OptColId = "shares" | "avg_cost" | "price" | "per_share" | "pct" | "day_high" | "day_low" | "volume";

const OPT_COLS: { id: OptColId; label: string; defaultOn: boolean }[] = [
  { id: "shares",    label: "股數",    defaultOn: true  },
  { id: "avg_cost",  label: "成本",    defaultOn: true  },
  { id: "price",     label: "現價",    defaultOn: true  },
  { id: "per_share", label: "單股漲跌", defaultOn: true  },
  { id: "pct",       label: "漲跌%",   defaultOn: true  },
  { id: "day_high",  label: "最高",    defaultOn: false },
  { id: "day_low",   label: "最低",    defaultOn: false },
  { id: "volume",    label: "成交量",  defaultOn: false },
];

const DEFAULT_ORDER = OPT_COLS.map(c => c.id);

function defaultOptCols(): Set<string> {
  return new Set(OPT_COLS.filter(c => c.defaultOn).map(c => c.id));
}

function loadOptCols(): Set<string> {
  if (typeof window === "undefined") return defaultOptCols();
  try {
    const stored = localStorage.getItem(VIS_KEY);
    return stored ? new Set(JSON.parse(stored)) : defaultOptCols();
  } catch { return defaultOptCols(); }
}

function saveOptCols(set: Set<string>) {
  try { localStorage.setItem(VIS_KEY, JSON.stringify([...set])); } catch { /* silent */ }
}

function loadColOrder(): OptColId[] {
  if (typeof window === "undefined") return [...DEFAULT_ORDER] as OptColId[];
  try {
    const stored = localStorage.getItem(ORDER_KEY);
    if (!stored) return [...DEFAULT_ORDER] as OptColId[];
    const parsed = JSON.parse(stored) as OptColId[];
    const missing = DEFAULT_ORDER.filter(id => !parsed.includes(id as OptColId)) as OptColId[];
    return [...parsed, ...missing];
  } catch { return [...DEFAULT_ORDER] as OptColId[]; }
}

function saveColOrder(order: OptColId[]) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* silent */ }
}

function buildCols(currency: Currency, optCols: Set<string>, colOrder: OptColId[]): ColDef[] {
  const sym = currency === "TWD" ? "NT$" : "USD";
  const priceSym = currency === "TWD" ? "NT$" : "$";
  const d = currency === "TWD" ? 2 : 3;

  const OPT_DEFS: Record<string, ColDef> = {
    shares:    { key: "shares",    label: "股數",    fmt: r => r.shares.toLocaleString() },
    avg_cost:  { key: "avg_cost",  label: `成本 (${sym})`, fmt: r => r.avg_cost.toFixed(3) },
    price:     { key: "price",     label: "現價",    fmt: r => r.price !== null ? `${priceSym}${r.price.toFixed(2)}` : "—" },
    per_share: { key: "per_share", label: "單股漲跌", fmt: r => {
      if (r.per_share === null) return "—";
      return `${r.per_share >= 0 ? "+" : ""}${priceSym}${Math.abs(r.per_share).toFixed(d)}`;
    }},
    pct:       { key: "pct",       label: "漲跌%",   fmt: r => r.pct !== null ? fmtPct(r.pct) : "—" },
    day_high:  { key: "day_high" as Col, label: "最高", fmt: r => r.day_high !== null ? `${priceSym}${r.day_high.toFixed(2)}` : "—" },
    day_low:   { key: "day_low"  as Col, label: "最低", fmt: r => r.day_low  !== null ? `${priceSym}${r.day_low.toFixed(2)}`  : "—" },
    volume:    { key: "volume"   as Col, label: "成交量", fmt: r => r.volume !== null ? Math.round(r.volume).toLocaleString() : "—" },
  };

  const ticker: ColDef    = { key: "ticker",     label: "代號", fmt: r => r.ticker };
  const todayGain: ColDef = { key: "today_gain", label: `今日總損益 (${sym})`,
    fmt: r => r.today_gain !== null ? fmtMoney(r.today_gain, currency) : "—" };
  const unreal: ColDef    = { key: "unreal_gain", label: "未實現損益",
    fmt: r => {
      if (r.unreal_gain === null) return "—";
      const pct = r.unreal_pct !== null ? ` (${fmtPct(r.unreal_pct)})` : "";
      return `${fmtMoney(r.unreal_gain, currency)}${pct}`;
    }};

  const middle = colOrder
    .filter(id => optCols.has(id))
    .map(id => OPT_DEFS[id])
    .filter(Boolean);

  return [ticker, ...middle, todayGain, unreal];
}

function colorOf(val: number | null) {
  if (val === null) return "";
  return val >= 0 ? "pos" : "neg";
}

function sortRows(rows: PortfolioRow[], ss: SortState): PortfolioRow[] {
  if (!ss.col) return rows;
  return [...rows].sort((a, b) => {
    const av = a[ss.col!] as number | string | null;
    const bv = b[ss.col!] as number | string | null;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return ss.dir === "asc" ? cmp : -cmp;
  });
}

export function PnLTable({ rows, currency }: { rows: PortfolioRow[]; currency: Currency }) {
  const [ss, setSS] = useState<SortState>({ col: null, dir: "desc" });
  const [optCols, setOptCols]   = useState<Set<string>>(defaultOptCols());
  const [colOrder, setColOrder] = useState<OptColId[]>([...DEFAULT_ORDER] as OptColId[]);
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOptCols(loadOptCols());
    setColOrder(loadColOrder());
  }, []);

  useEffect(() => {
    if (!showPicker) return;
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPicker]);

  function toggleOptCol(id: string) {
    setOptCols(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveOptCols(next);
      return next;
    });
  }

  function moveCol(idx: number, dir: -1 | 1) {
    setColOrder(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      saveColOrder(next);
      return next;
    });
  }

  const cols = buildCols(currency, optCols, colOrder);
  const sorted = sortRows(rows, ss);

  function onHeaderClick(col: Col) {
    setSS(prev => {
      if (prev.col !== col) return { col, dir: col === "ticker" ? "asc" : "desc" };
      const initial = col === "ticker" ? "asc" : "desc";
      if (prev.dir !== initial) return { col: null, dir: "desc" };
      return { col, dir: initial === "asc" ? "desc" : "asc" };
    });
  }

  const totalToday = rows.reduce((s, r) => s + (r.today_gain ?? 0), 0);
  const totalUnreal = rows.reduce((s, r) => s + (r.unreal_gain ?? 0), 0);
  const hasData = rows.some(r => r.price !== null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6, position: "relative" }} ref={pickerRef}>
        <button className="dash-btn dash-btn-sm" onClick={() => setShowPicker(s => !s)} style={{ fontSize: "0.7rem" }}>
          ⊞ 欄位
        </button>
        {showPicker && (
          <div style={{
            position: "absolute", top: "110%", right: 0, zIndex: 100,
            background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)",
            borderRadius: 6, padding: "10px 14px", minWidth: 160,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}>
            <div style={{ fontSize: "0.65rem", color: "var(--dim)", letterSpacing: "0.08em", marginBottom: 8 }}>顯示欄位 (可調順序)</div>
            {colOrder.map((id, i) => {
              const meta = OPT_COLS.find(c => c.id === id);
              if (!meta) return null;
              return (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, cursor: "pointer", fontSize: "0.78rem", color: "var(--text)" }}>
                    <input type="checkbox" checked={optCols.has(id)} onChange={() => toggleOptCol(id)} style={{ accentColor: "var(--teal)" }} />
                    {meta.label}
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <button
                      onClick={() => moveCol(i, -1)}
                      disabled={i === 0}
                      style={{ background: "none", border: "none", color: i === 0 ? "var(--dim)" : "var(--teal)", cursor: i === 0 ? "default" : "pointer", fontSize: 9, lineHeight: 1, padding: "1px 2px" }}
                    >▲</button>
                    <button
                      onClick={() => moveCol(i, 1)}
                      disabled={i === colOrder.length - 1}
                      style={{ background: "none", border: "none", color: i === colOrder.length - 1 ? "var(--dim)" : "var(--teal)", cursor: i === colOrder.length - 1 ? "default" : "pointer", fontSize: 9, lineHeight: 1, padding: "1px 2px" }}
                    >▼</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="pnl-table">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.key} className={ss.col === c.key ? "active" : ""} onClick={() => onHeaderClick(c.key)}>
                  {c.label}{ss.col === c.key ? (ss.dir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.ticker}>
                {cols.map(c => {
                  const val = row[c.key] as number | null;
                  const needsColor = ["per_share", "pct", "today_gain", "unreal_gain"].includes(c.key);
                  return (
                    <td key={c.key} className={needsColor ? colorOf(val) : ""}>
                      {c.key === "ticker" && row.name ? (
                        <div>
                          <div>{row.ticker}</div>
                          <div style={{ color: "var(--dim)", fontSize: "0.68rem", fontWeight: 400, letterSpacing: 0 }}>{row.name}</div>
                        </div>
                      ) : c.fmt(row)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {hasData && (
            <tfoot>
              <tr>
                <td colSpan={cols.length - 2} style={{ color: "var(--dim)", fontSize: "0.72rem", letterSpacing: "0.08em" }}>合計</td>
                <td className={colorOf(totalToday)}>{fmtMoney(totalToday, currency)}</td>
                <td className={colorOf(totalUnreal)}>{fmtMoney(totalUnreal, currency)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
