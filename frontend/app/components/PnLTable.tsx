"use client";
import React, { useState, useEffect, useRef } from "react";
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

const ALL_ACCOUNTS = ["複委託（台幣戶）", "複委託（美金戶）", "台股帳戶"];
const SYNC_EVENT = "pnl-cols-sync";

// Only ticker is always shown; everything else is optional

type OptColId =
  | "shares" | "avg_cost" | "cost_basis" | "price"
  | "day_high" | "day_low" | "volume"
  | "per_share" | "pct"
  | "today_gain" | "unreal_gain";

const OPT_COLS: { id: OptColId; label: string; defaultOn: boolean }[] = [
  { id: "shares",      label: "股數",      defaultOn: true  },
  { id: "avg_cost",    label: "單股成本",   defaultOn: true  },
  { id: "cost_basis",  label: "總成本",     defaultOn: false },
  { id: "price",       label: "現價",      defaultOn: true  },
  { id: "day_high",    label: "每日最高",   defaultOn: false },
  { id: "day_low",     label: "每日最低",   defaultOn: false },
  { id: "volume",      label: "成交量",     defaultOn: false },
  { id: "per_share",   label: "單股漲跌",   defaultOn: true  },
  { id: "pct",         label: "單股漲跌%",  defaultOn: true  },
  { id: "today_gain",  label: "今日損益",   defaultOn: true  },
  { id: "unreal_gain", label: "未實現損益", defaultOn: true  },
];

const DEFAULT_ORDER = OPT_COLS.map(c => c.id);

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
  };

  const tickerDef: ColDef = { key: "ticker", label: "代號", fmt: r => r.ticker };
  const middle = colOrder.filter(id => optCols.has(id)).map(id => DEFS[id]).filter(Boolean);
  return [tickerDef, ...middle];
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

function SortableColRow({ id, label, checked, onToggle }: {
  id: string; label: string; checked: boolean; onToggle: (id: string) => void;
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
    </div>
  );
}

export function PnLTable({ rows, currency, account = "" }: { rows: PortfolioRow[]; currency: Currency; account?: string }) {
  const [ss, setSS]           = useState<SortState>({ col: null, dir: "desc" });
  const [optCols, setOptCols] = useState<Set<string>>(defaultOptCols());
  const [colOrder, setColOrder] = useState<OptColId[]>([...DEFAULT_ORDER] as OptColId[]);
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getSettings().then(s => {
      const acct = s.pnl_cols?.[account];
      if (acct) {
        setOptCols(new Set(acct.vis));
        setColOrder(mergeOrder(acct.order));
      } else if (s.col_vis || s.col_order) {
        // migrate from old flat format
        if (s.col_vis)   setOptCols(new Set(s.col_vis));
        if (s.col_order) setColOrder(mergeOrder(s.col_order));
      }
    }).catch(() => {});

    // Listen for "apply to all" broadcasts from other tabs
    function onSync(e: Event) {
      const { vis, order } = (e as CustomEvent<{ vis: string[]; order: string[] }>).detail;
      setOptCols(new Set(vis));
      setColOrder(mergeOrder(order));
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

  function savePrefs(vis: Set<string>, order: OptColId[]) {
    api.setSettings({ pnl_cols: { [account]: { vis: [...vis], order } } }).catch(() => {});
  }

  function toggleOptCol(id: string) {
    setOptCols(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      savePrefs(next, colOrder);
      return next;
    });
  }

  function handleColDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id as OptColId), prev.indexOf(over.id as OptColId));
      savePrefs(optCols, next);
      return next;
    });
  }

  function applyToAll() {
    const vis = [...optCols];
    const order = colOrder;
    const pnl_cols = Object.fromEntries(ALL_ACCOUNTS.map(a => [a, { vis, order }]));
    api.setSettings({ pnl_cols }).catch(() => {});
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { vis, order } }));
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
  const hasData     = rows.some(r => r.price !== null);
  const showTfoot   = hasData && cols.some(c => ["today_gain", "unreal_gain", "cost_basis"].includes(c.key));

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
            borderRadius: 6, padding: "10px 14px", minWidth: 165,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}>
            <div style={{ fontSize: "0.65rem", color: "var(--dim)", letterSpacing: "0.08em", marginBottom: 8 }}>顯示欄位（拖曳調順序）</div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColDragEnd}>
              <SortableContext items={colOrder} strategy={verticalListSortingStrategy}>
                {colOrder.map(id => {
                  const meta = OPT_COLS.find(c => c.id === id);
                  if (!meta) return null;
                  return <SortableColRow key={id} id={id} label={meta.label} checked={optCols.has(id)} onToggle={toggleOptCol} />;
                })}
              </SortableContext>
            </DndContext>
            <div style={{ borderTop: "1px solid rgba(8,120,164,0.25)", marginTop: 8, paddingTop: 8 }}>
              <button
                className="dash-btn dash-btn-sm"
                onClick={applyToAll}
                style={{ width: "100%", fontSize: "0.65rem" }}
              >
                套用至全部帳戶
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="pnl-table">
          <thead>
            <tr>
              {cols.map(c => {
                const sortable = c.key !== "ticker";
                return (
                  <th
                    key={c.key}
                    className={ss.col === c.key ? "active" : ""}
                    onClick={() => sortable && onHeaderClick(c.key)}
                    style={{ cursor: sortable ? "pointer" : "default" }}
                  >
                    {c.label}{ss.col === c.key ? (ss.dir === "asc" ? " ↑" : " ↓") : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.ticker}>
                {cols.map(c => {
                  const val = row[c.key] as number | null;
                  const needsColor = ["per_share", "pct", "today_gain", "unreal_gain"].includes(c.key);
                  const isHigh     = c.key === "day_high";
                  const isLow      = c.key === "day_low";
                  const isUserData = ["shares", "avg_cost", "cost_basis"].includes(c.key);
                  return (
                    <td key={c.key}
                      className={needsColor ? colorOf(val) : ""}
                      style={isUserData ? { color: "var(--gold)" } : isHigh ? { color: "#A78BFA" } : isLow ? { color: "#5BB8D4" } : undefined}
                    >
                      {c.key === "ticker" && row.name ? (
                        <div>
                          <div>{row.ticker}</div>
                          <div style={{ color: "var(--dim)", fontSize: "0.68rem", fontWeight: 400, letterSpacing: 0 }}>{row.name}</div>
                        </div>
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
              <tr>
                {cols.map(c => {
                  if (c.key === "ticker")      return <td key="ticker" style={{ color: "var(--dim)", fontSize: "0.72rem", letterSpacing: "0.08em" }}>合計</td>;
                  if (c.key === "today_gain")  return <td key="today_gain"  className={colorOf(totalToday)}>{fmtMoney(totalToday, currency)}</td>;
                  if (c.key === "unreal_gain") return <td key="unreal_gain" className={colorOf(totalUnreal)}>{fmtMoney(totalUnreal, currency)}</td>;
                  if (c.key === "cost_basis")  return <td key="cost_basis"  style={{ color: "var(--text)" }}>{fmtMoney(totalCost, currency)}</td>;
                  return <td key={c.key} />;
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
