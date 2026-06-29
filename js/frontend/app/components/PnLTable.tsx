"use client";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { PortfolioRow, SortState } from "@/lib/types";
import { api, fmtMoney, fmtPct } from "@/lib/api";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Currency = "USD" | "TWD";
type Col = keyof PortfolioRow;

interface ColDef {
  key: Col;
  label: string;
  fmt: (row: PortfolioRow) => string;
}

// Populated dynamically by the parent component; fallback to the legacy 3 accounts
let _allAccountKeys: string[] = ["美股複委託（台幣帳戶）", "美股複委託（美金帳戶）", "台股帳戶"];
export function setAllAccountKeys(keys: string[]) { _allAccountKeys = keys; }
const SYNC_EVENT = "pnl-cols-sync";

// Only ticker is always shown; everything else is optional

type OptColId =
  | "shares" | "avg_cost" | "cost_basis" | "price" | "market_value"
  | "day_high" | "day_low" | "volume"
  | "week_high" | "week_low"
  | "per_share" | "pct"
  | "today_gain" | "unreal_gain"
  | "ytd_gain" | "ytd_pct";

const OPT_COLS: { id: OptColId; label: string; defaultOn: boolean }[] = [
  { id: "shares",      label: "股數",        defaultOn: true  },
  { id: "avg_cost",    label: "單股成本",     defaultOn: true  },
  { id: "cost_basis",     label: "總成本",       defaultOn: false },
  { id: "price",          label: "現價",        defaultOn: true  },
  { id: "market_value",   label: "市值",        defaultOn: false },
  { id: "day_high",    label: "每日最高",     defaultOn: false },
  { id: "day_low",     label: "每日最低",     defaultOn: false },
  { id: "volume",      label: "成交量",       defaultOn: false },
  { id: "week_high",   label: "52W 最高",    defaultOn: false },
  { id: "week_low",    label: "52W 最低",    defaultOn: false },
  { id: "per_share",   label: "單股漲跌",     defaultOn: true  },
  { id: "pct",         label: "單股漲跌%",    defaultOn: true  },
  { id: "today_gain",  label: "今日損益",     defaultOn: true  },
  { id: "unreal_gain", label: "未實現損益",   defaultOn: true  },
  { id: "ytd_gain",    label: "YTD 漲幅",    defaultOn: false },
  { id: "ytd_pct",     label: "YTD 漲幅%",  defaultOn: false },
];

const DEFAULT_ORDER = OPT_COLS.map(c => c.id);

const TOOLTIPS: Partial<Record<string, string>> = {
  avg_cost:    "總成本 / 股數",
  today_gain:  "今日漲跌 × 股數",
  unreal_gain: "總市價 - 總成本",
  week_high:   "過去 52 週（約一年）的最高成交價",
  week_low:    "過去 52 週（約一年）的最低成交價",
  ytd_gain:    "Year to Date：今年 1 月 1 日起至今的累計漲幅",
  ytd_pct:     "Year to Date：今年 1 月 1 日起至今的累計漲幅%",
};

function ColTooltip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className="col-tip"
      onMouseEnter={e => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const half = 130; // half of max tooltip width
        const x = Math.max(half, Math.min(r.left + r.width / 2, window.innerWidth - half));
        setPos({ x, y: r.top });
      }}
      onMouseLeave={() => setPos(null)}
    >
      <span className="col-tip-icon">ⓘ</span>
      {pos && (
        <span style={{
          position: "fixed", left: pos.x, top: pos.y - 8,
          transform: "translate(-50%, -100%)",
          background: "#001828", border: "1px solid rgba(30,207,214,0.3)",
          color: "var(--text)", fontSize: "0.72rem", fontWeight: 400, letterSpacing: 0,
          padding: "5px 10px", borderRadius: 5, whiteSpace: "nowrap",
          zIndex: 300, boxShadow: "0 4px 12px rgba(0,0,0,0.4)", pointerEvents: "none",
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

function defaultOptCols(): Set<string> {
  return new Set(OPT_COLS.filter(c => c.defaultOn).map(c => c.id));
}

function mergeOrder(stored: string[]): OptColId[] {
  const valid = stored.filter(id => DEFAULT_ORDER.includes(id as OptColId)) as OptColId[];
  const missing = DEFAULT_ORDER.filter(id => !valid.includes(id as OptColId)) as OptColId[];
  return [...valid, ...missing];
}

function buildCols(currency: Currency, optCols: Set<string>, colOrder: OptColId[]): ColDef[] {
  const sym      = currency === "TWD" ? "NT$" : "USD";
  const priceSym = currency === "TWD" ? "NT$" : "$";
  const d        = currency === "TWD" ? 2 : 3;

  const DEFS: Record<string, ColDef> = {
    shares:      { key: "shares",      label: "股數",    fmt: r => r.shares.toLocaleString() },
    avg_cost:    { key: "avg_cost",    label: `單股成本 (${sym})`, fmt: r => r.avg_cost.toFixed(3) },
    cost_basis:  { key: "cost_basis",  label: `總成本 (${sym})`,  fmt: r => fmtMoney(r.cost_basis, currency) },
    price:       { key: "price",       label: "現價",    fmt: r => r.price !== null ? `${priceSym}${r.price.toFixed(2)}` : "—" },
    market_value: { key: "market_value" as Col, label: `市值 (${sym})`, fmt: r => r.price !== null ? fmtMoney(r.price * r.shares, currency) : "—" },
    day_high:    { key: "day_high" as Col, label: "每日最高", fmt: r => r.day_high !== null ? `${priceSym}${r.day_high.toFixed(2)}` : "—" },
    day_low:     { key: "day_low"  as Col, label: "每日最低", fmt: r => r.day_low  !== null ? `${priceSym}${r.day_low.toFixed(2)}`  : "—" },
    volume:      { key: "volume"   as Col, label: "成交量", fmt: r => r.volume !== null ? Math.round(r.volume).toLocaleString() : "—" },
    per_share:   { key: "per_share",   label: "單股漲跌", fmt: r => {
      if (r.per_share === null) return "—";
      return `${r.per_share >= 0 ? "+" : ""}${priceSym}${Math.abs(r.per_share).toFixed(d)}`;
    }},
    pct:         { key: "pct",         label: "單股漲跌%", fmt: r => r.pct !== null ? fmtPct(r.pct) : "—" },
    today_gain:  { key: "today_gain",  label: `今日損益 (${sym})`,   fmt: r => r.today_gain  !== null ? fmtMoney(r.today_gain, currency)  : "—" },
    unreal_gain: { key: "unreal_gain", label: `未實現損益 (${sym})`, fmt: r => {
      if (r.unreal_gain === null) return "—";
      const pct = r.unreal_pct !== null ? ` (${fmtPct(r.unreal_pct)})` : "";
      return `${fmtMoney(r.unreal_gain, currency)}${pct}`;
    }},
    week_high: { key: "week_high" as Col, label: "52W 最高", fmt: r => r.week_high !== null ? `${priceSym}${r.week_high.toFixed(2)}` : "—" },
    week_low:  { key: "week_low"  as Col, label: "52W 最低", fmt: r => r.week_low  !== null ? `${priceSym}${r.week_low.toFixed(2)}`  : "—" },
    ytd_gain:  { key: "ytd_gain"  as Col, label: `YTD 漲幅 (${sym})`,  fmt: r => r.ytd_gain !== null ? fmtMoney(r.ytd_gain, currency) : "—" },
    ytd_pct:   { key: "ytd_pct"   as Col, label: "YTD 漲幅%",          fmt: r => r.ytd_pct  !== null ? fmtPct(r.ytd_pct) : "—" },
  };

  const tickerDef: ColDef = { key: "ticker", label: "代號", fmt: r => r.ticker };
  const middle = colOrder.filter(id => optCols.has(id)).map(id => DEFS[id]).filter(Boolean);
  return [tickerDef, ...middle];
}

function colorOf(val: number | null) {
  if (val === null) return "";
  return val >= 0 ? "pos" : "neg";
}

function rowVal(row: PortfolioRow, col: string): number | string | null {
  if (col === "market_value") return row.price !== null ? row.price * row.shares : null;
  return (row as unknown as Record<string, number | string | null>)[col] ?? null;
}

function sortRows(rows: PortfolioRow[], ss: SortState): PortfolioRow[] {
  if (!ss.col) return rows;
  return [...rows].sort((a, b) => {
    const av = rowVal(a, ss.col!);
    const bv = rowVal(b, ss.col!);
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return ss.dir === "asc" ? cmp : -cmp;
  });
}

function SortableColRow({ id, label, checked, onToggle, hasDivider, onToggleDivider }: {
  id: string; label: string; checked: boolean; onToggle: (id: string) => void;
  hasDivider: boolean; onToggleDivider: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1,
        display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}
    >
      <span {...attributes} {...listeners}
        style={{ cursor: "grab", color: "var(--dim)", fontSize: 13, lineHeight: 1, userSelect: "none" }}>
        ☰
      </span>
      <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, cursor: "pointer", fontSize: "0.78rem", color: "var(--text)" }}>
        <input type="checkbox" checked={checked} onChange={() => onToggle(id)} style={{ accentColor: "var(--teal)" }} />
        {label}
      </label>
      {checked && (
        <button onClick={() => onToggleDivider(id)} title="右側分隔線"
          style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", opacity: hasDivider ? 1 : 0.35,
            color: hasDivider ? "var(--teal)" : "var(--dim)", fontSize: "0.78rem" }}>
          │
        </button>
      )}
    </div>
  );
}

export function PnLTable({ rows, currency, account = "", label }: { rows: PortfolioRow[]; currency: Currency; account?: string; label?: string }) {
  const [ss, setSS]           = useState<SortState>({ col: null, dir: "desc" });
  const [optCols, setOptCols] = useState<Set<string>>(defaultOptCols());
  const [colOrder, setColOrder] = useState<OptColId[]>([...DEFAULT_ORDER] as OptColId[]);
  const [dividers, setDividers] = useState<Set<string>>(new Set()); // column IDs after which a divider line is shown
  const [showPicker, setShowPicker] = useState(false);
  const [appliedTo, setAppliedTo] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getSettings().then(s => {
      const acct = s.pnl_cols?.[account] as { vis?: string[]; order?: string[]; dividers?: string[] } | undefined;
      const dflt = account ? s.pnl_cols?.["__default__"] as { vis?: string[]; order?: string[]; dividers?: string[] } | undefined : undefined;
      const src = acct ?? dflt;
      if (src) {
        if (src.vis)      setOptCols(new Set(src.vis));
        if (src.order)    setColOrder(mergeOrder(src.order));
        if (src.dividers) setDividers(new Set(src.dividers));
      } else if (s.col_vis || s.col_order) {
        // migrate from old flat format
        if (s.col_vis)   setOptCols(new Set(s.col_vis));
        if (s.col_order) setColOrder(mergeOrder(s.col_order));
      }
    }).catch(() => {});

    function onSync(e: Event) {
      const { target, vis, order, dividers: divs } = (e as CustomEvent<{ target: string; vis: string[]; order: string[]; dividers?: string[] }>).detail;
      if (target !== account) return;
      setOptCols(new Set(vis));
      setColOrder(mergeOrder(order));
      if (divs) setDividers(new Set(divs));
    }
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  useEffect(() => {
    if (!showPicker) return;
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPicker]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function savePrefs(vis: Set<string>, order: OptColId[], divs: Set<string>) {
    api.setSettings({ pnl_cols: { [account]: { vis: [...vis], order, dividers: [...divs] } } }).catch(() => {});
  }

  function toggleOptCol(id: string) {
    setOptCols(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      savePrefs(next, colOrder, dividers);
      return next;
    });
  }

  function toggleDivider(id: string) {
    setDividers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      savePrefs(optCols, colOrder, next);
      return next;
    });
  }

  function handleColDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id as OptColId), prev.indexOf(over.id as OptColId));
      savePrefs(optCols, next, dividers);
      return next;
    });
  }

  function applyTo(target: string) {
    const vis = [...optCols];
    const order = colOrder;
    const divs = [...dividers];
    api.setSettings({ pnl_cols: { [target]: { vis, order, dividers: divs } } }).catch(() => {});
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { target, vis, order, dividers: divs } }));
    setAppliedTo(target);
    setTimeout(() => setAppliedTo(null), 1500);
  }

  const cols   = buildCols(currency, optCols, colOrder);
  const sorted = sortRows(rows, ss);

  function onHeaderClick(col: Col) {
    if (col === "ticker") return; // ticker not sortable
    setSS(prev => {
      if (prev.col !== col) return { col, dir: "desc" };
      if (prev.dir === "desc") return { col, dir: "asc" };
      return { col: null, dir: "desc" };
    });
  }

  const totalToday  = rows.reduce((s, r) => s + (r.today_gain  ?? 0), 0);
  const totalUnreal = rows.reduce((s, r) => s + (r.unreal_gain ?? 0), 0);
  const totalCost   = rows.reduce((s, r) => s + r.cost_basis, 0);
  const totalMV     = rows.reduce((s, r) => s + (r.price !== null ? r.price * r.shares : 0), 0);
  const hasData     = rows.some(r => r.price !== null);
  const showTfoot   = hasData && cols.some(c => ["today_gain", "unreal_gain", "cost_basis", "market_value"].includes(c.key));

  // Divider line: borderRight on the divider column with extra paddingRight so the line sits
  // closer to the right column (more space on the left side of the line).
  const divStyle = (idx: number): React.CSSProperties => {
    const styles: React.CSSProperties = {};
    // This column owns a divider: borderRight + paddingRight
    if (dividers.has(cols[idx].key)) {
      const pr = cols[idx].key === "ticker" ? "5px" : "24px";
      styles.borderRight = "2px solid rgba(30,207,214,0.4)";
      styles.paddingRight = pr;
    }
    // Previous column has a non-ticker divider: collapse left padding to 0
    if (idx > 0 && dividers.has(cols[idx - 1].key) && cols[idx - 1].key !== "ticker") {
      styles.paddingLeft = "0px";
    }
    return styles;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, position: "relative" }} ref={pickerRef}>
        {label ? <span style={{ fontSize: "0.7rem", color: "var(--dim)", letterSpacing: "0.08em" }}>{label}</span> : <span />}
        <button className="dash-btn dash-btn-sm" onClick={() => setShowPicker(s => !s)} style={{ fontSize: "0.7rem" }}>
          ⊞ 欄位
        </button>
        {showPicker && (
          <div style={{
            position: "absolute", top: "110%", right: 0, zIndex: 100,
            background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)",
            borderRadius: 6, padding: "10px 14px", minWidth: 165,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}>
            <div style={{ fontSize: "0.65rem", color: "var(--dim)", letterSpacing: "0.08em", marginBottom: 8 }}>顯示欄位（拖曳調順序）</div>
            {/* Ticker is always first and non-removable; only divider is togglable */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <span style={{ color: "rgba(100,120,140,0.3)", fontSize: 13, lineHeight: 1, userSelect: "none" }}>☰</span>
              <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, fontSize: "0.78rem", color: "var(--dim)" }}>
                <input type="checkbox" checked disabled style={{ accentColor: "var(--teal)", opacity: 0.45 }} />
                代號
              </label>
              <button onClick={() => toggleDivider("ticker")} title="右側分隔線"
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px",
                  opacity: dividers.has("ticker") ? 1 : 0.35,
                  color: dividers.has("ticker") ? "var(--teal)" : "var(--dim)", fontSize: "0.78rem" }}>
                │
              </button>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColDragEnd}>
              <SortableContext items={colOrder} strategy={verticalListSortingStrategy}>
                {colOrder.map(id => {
                  const meta = OPT_COLS.find(c => c.id === id);
                  if (!meta) return null;
                  return <SortableColRow key={id} id={id} label={meta.label} checked={optCols.has(id)} onToggle={toggleOptCol} hasDivider={dividers.has(id)} onToggleDivider={toggleDivider} />;
                })}
              </SortableContext>
            </DndContext>
            {account && (
              <div style={{ borderTop: "1px solid rgba(8,120,164,0.25)", marginTop: 8, paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: "0.62rem", color: "var(--dim)", letterSpacing: "0.06em", marginBottom: 2 }}>套用至 — 各帳戶</div>
                {_allAccountKeys.filter(a => a !== account).map(a => (
                  <button key={a} className="dash-btn dash-btn-sm" onClick={() => applyTo(a)}
                    style={{ fontSize: "0.65rem", textAlign: "left", color: appliedTo === a ? "var(--teal)" : undefined }}>
                    {appliedTo === a ? "✓ 已套用" : a}
                  </button>
                ))}
                <div style={{ fontSize: "0.62rem", color: "var(--dim)", letterSpacing: "0.06em", marginTop: 6, marginBottom: 2 }}>套用至 — 整體損益</div>
                {_allAccountKeys.filter(a => `overall:${a}` !== account).map(a => (
                  <button key={`overall:${a}`} className="dash-btn dash-btn-sm" onClick={() => applyTo(`overall:${a}`)}
                    style={{ fontSize: "0.65rem", textAlign: "left", color: appliedTo === `overall:${a}` ? "var(--teal)" : undefined }}>
                    {appliedTo === `overall:${a}` ? "✓ 已套用" : a}
                  </button>
                ))}
                <button className="dash-btn dash-btn-sm" onClick={() => _allAccountKeys.filter(a => `overall:${a}` !== account).forEach(a => applyTo(`overall:${a}`))}
                  style={{ fontSize: "0.65rem", textAlign: "left", marginTop: 2, color: "rgba(237,209,112,0.8)", borderColor: "rgba(237,209,112,0.3)" }}>
                  套用至全部整體損益
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="pnl-table">
          <thead>
            <tr>
              {cols.map((c, idx) => {
                const sortable = c.key !== "ticker";
                return (
                  <th
                    key={c.key}
                    className={ss.col === c.key ? "active" : ""}
                    onClick={() => sortable && onHeaderClick(c.key)}
                    style={{ cursor: sortable ? "pointer" : "default", ...divStyle(idx) }}
                  >
                    {c.label}{ss.col === c.key ? (ss.dir === "asc" ? " ↑" : " ↓") : ""}
                    {TOOLTIPS[c.key] && <ColTooltip text={TOOLTIPS[c.key]!} />}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.ticker}>
                {cols.map((c, idx) => {
                  const val = row[c.key] as number | null;
                  const needsColor = ["per_share", "pct", "today_gain", "unreal_gain", "ytd_gain", "ytd_pct"].includes(c.key);
                  const isHigh     = c.key === "day_high";
                  const isLow      = c.key === "day_low";
                  const isWeekHigh = c.key === "week_high";
                  const isWeekLow  = c.key === "week_low";
                  const isUserData = ["shares", "avg_cost", "cost_basis"].includes(c.key);
                  return (
                    <td key={c.key}
                      className={needsColor ? colorOf(val) : ""}
                      style={{
                        ...(isUserData ? { color: "var(--gold)" } : isHigh ? { color: "#A78BFA" } : isLow ? { color: "#5BB8D4" } : isWeekHigh ? { color: "#FB923C" } : isWeekLow ? { color: "#60A5FA" } : {}),
                        ...divStyle(idx),
                      }}
                    >
                      {c.key === "ticker" ? (
                        <Link href={`/stock/${encodeURIComponent(row.ticker)}`}
                          style={{ color: "var(--teal)", textDecoration: "none", fontWeight: 700 }}
                          title="查看K線圖">
                          <div>{row.ticker}</div>
                          {row.name && <div style={{ color: "var(--dim)", fontSize: "0.68rem", fontWeight: 400, letterSpacing: 0 }}>{row.name}</div>}
                        </Link>
                      ) : c.key === "day_high" && row.day_high !== null && row.prev_close !== null ? (
                        <div>
                          <div>{c.fmt(row)}</div>
                          <div style={{ fontSize: "0.68rem", color: "#A78BFA" }}>
                            {(() => { const p = (row.day_high - row.prev_close) / row.prev_close * 100; return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`; })()}
                          </div>
                        </div>
                      ) : c.key === "day_low" && row.day_low !== null && row.prev_close !== null ? (
                        <div>
                          <div>{c.fmt(row)}</div>
                          <div style={{ fontSize: "0.68rem", color: "#5BB8D4" }}>
                            {(() => { const p = (row.day_low - row.prev_close) / row.prev_close * 100; return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`; })()}
                          </div>
                        </div>
                      ) : c.fmt(row)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {showTfoot && (
            <tfoot>
              <tr style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                {cols.map((c, idx) => {
                  const { borderRight: _br, ...ds } = divStyle(idx);
                  if (c.key === "ticker")      return <td key="ticker" style={{ color: "var(--dim)", fontSize: "0.72rem", letterSpacing: "0.08em", fontWeight: 400, ...ds }}>合計</td>;
                  if (c.key === "today_gain")  return <td key="today_gain"  className={colorOf(totalToday)} style={ds}>{fmtMoney(totalToday, currency)}</td>;
                  if (c.key === "unreal_gain") { const pct = totalCost ? totalUnreal / totalCost * 100 : null; return <td key="unreal_gain" className={colorOf(totalUnreal)} style={ds}>{fmtMoney(totalUnreal, currency)}{pct !== null ? ` (${fmtPct(pct)})` : ""}</td>; }
                  if (c.key === "cost_basis")    return <td key="cost_basis"    style={{ color: "var(--gold)", ...ds }}>{fmtMoney(totalCost, currency)}</td>;
                  if ((c.key as string) === "market_value") return <td key="market_value"  style={{ color: "var(--text)", ...ds }}>{fmtMoney(totalMV, currency)}</td>;
                  return <td key={c.key} style={ds} />;
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
