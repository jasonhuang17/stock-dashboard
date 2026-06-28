"use client";
import { useState, useEffect, useCallback, type ReactNode } from "react";
import { api, fmtMoney, fmtPct } from "@/lib/api";
import type { PortfolioRow, PremarketPortfolioRow, Portfolio, Account, AccountGroup } from "@/lib/types";
import { twName } from "@/lib/tw-names";
import { PnLTable, setAllAccountKeys } from "./PnLTable";
import { PnLChart } from "./PnLChart";
import { SortableChips } from "./SortableChips";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Currency = "USD" | "TWD";

function LockTip({ text, children }: { text: string; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  return (
    <span style={{ marginLeft: "auto", display: "inline-flex" }}
      onMouseEnter={e => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPos({ x: r.right, y: r.top });
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      <span style={{
        position: "fixed", left: pos.x, top: pos.y - 8,
        transform: "translate(-100%, -100%)",
        opacity: hovered ? 1 : 0, transition: "opacity 0.12s",
        pointerEvents: "none", background: "#001828",
        border: "1px solid rgba(30,207,214,0.3)", color: "var(--text)",
        fontSize: "0.72rem", fontWeight: 400, letterSpacing: 0,
        padding: "5px 10px", borderRadius: 5, whiteSpace: "nowrap",
        zIndex: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}>
        {text}
      </span>
    </span>
  );
}

// ── Per-account P&L tab ───────────────────────────────────────────────────────
function AccountPnL({ account, currency, refreshKey }: { account: string; currency: Currency; refreshKey: number }) {
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [ahRows, setAhRows] = useState<PremarketPortfolioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAH, setShowAH] = useState(false);

  const fetchRows = useCallback(async () => {
    setRefreshing(true);
    try {
      const [r, ah] = await Promise.all([
        api.portfolioRows(account),
        api.portfolioPremarketRows(account),
      ]);
      setRows(r);
      setAhRows(ah);
    } catch { /* silent */ }
    setLoading(false);
    setRefreshing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, refreshKey]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const totalToday     = rows.reduce((s, r) => s + (r.today_gain ?? 0), 0);
  const totalUnreal    = rows.reduce((s, r) => s + (r.unreal_gain ?? 0), 0);
  const totalMV        = rows.reduce((s, r) => s + ((r.price ?? 0) * r.shares), 0);
  const totalCostBasis = rows.reduce((s, r) => s + r.cost_basis, 0);
  const prevMV      = rows.reduce((s, r) => {
    const prev = r.prev_close ?? r.price ?? 0;
    return s + prev * r.shares;
  }, 0);
  const todayPct   = prevMV ? totalToday / prevMV * 100 : null;
  const unrealPct  = totalCostBasis ? totalUnreal / totalCostBasis * 100 : null;
  const hasData = rows.some(r => r.price !== null);

  if (loading) return <div style={{ padding: 20, color: "var(--dim)" }}>載入中… <span className="spinner" /></div>;
  if (!rows.length) return <div style={{ padding: 20, color: "var(--dim)", fontSize: "0.82rem" }}>尚無持倉</div>;

  return (
    <div>
      {hasData && (
        <div className="summary-bar" style={{ position: "relative" }}>
          {refreshing && (
            <span style={{ position: "absolute", top: 6, right: 8, fontSize: "0.65rem", color: "var(--dim)" }}>
              <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
            </span>
          )}
          <div style={{ display: "flex", gap: 20, borderRight: "1px solid rgba(8,120,164,0.3)", paddingRight: 24 }}>
            <div>
              <div className="summary-label">今日損益</div>
              <div className={`summary-value ${totalToday >= 0 ? "pos" : "neg"}`} style={{ fontSize: "1.15rem" }}>{fmtMoney(totalToday, currency)}</div>
            </div>
            {todayPct !== null && (
              <div>
                <div className="summary-label">今日 %</div>
                <div className={`summary-value ${todayPct >= 0 ? "pos" : "neg"}`} style={{ fontSize: "1.15rem" }}>{fmtPct(todayPct)}</div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 20, borderRight: "1px solid rgba(8,120,164,0.3)", paddingRight: 24 }}>
            <div>
              <div className="summary-label">未實現損益</div>
              <div className={`summary-value ${totalUnreal >= 0 ? "pos" : "neg"}`}>{fmtMoney(totalUnreal, currency)}</div>
            </div>
            {unrealPct !== null && (
              <div>
                <div className="summary-label">未實現 %</div>
                <div className={`summary-value ${unrealPct >= 0 ? "pos" : "neg"}`}>{fmtPct(unrealPct)}</div>
              </div>
            )}
          </div>
          <div>
            <div className="summary-label">總成本</div>
            <div className="summary-value" style={{ color: "var(--text)" }}>{fmtMoney(totalCostBasis, currency)}</div>
          </div>
          <div>
            <div className="summary-label">總市值</div>
            <div className="summary-value" style={{ color: "var(--text)" }}>{fmtMoney(totalMV, currency)}</div>
          </div>
        </div>
      )}
      <PnLTable rows={rows} currency={currency} account={account} />
      <PnLChart rows={rows} currency={currency} />

      {/* After-hours / pre-market section */}
      {ahRows.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button
            className="dash-btn dash-btn-sm"
            onClick={() => setShowAH(s => !s)}
            style={{ marginBottom: 8 }}
          >
            {showAH ? "🌙 收起盤後損益 ▲" : "🌙 盤後/前損益 ▼"}
          </button>
          {showAH && (
            <div style={{ overflowX: "auto" }}>
              <table className="pnl-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>代號</th>
                    <th>收盤價</th>
                    <th>盤後價</th>
                    <th>時間 (ET)</th>
                    <th>漲跌</th>
                    <th>漲跌%</th>
                    <th>盤後損益</th>
                  </tr>
                </thead>
                <tbody>
                  {ahRows.map(r => {
                    const sym = currency === "TWD" ? "NT$" : "$";
                    const chgCls = r.ah_change === null ? "" : r.ah_change >= 0 ? "pos" : "neg";
                    const timeStr = r.pm_time
                      ? new Date(r.pm_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
                      : "—";
                    return (
                      <tr key={r.ticker}>
                        <td style={{ textAlign: "left", color: "var(--teal)", fontWeight: 700 }}>
                          {r.ticker}
                          {currency === "TWD" && twName(r.ticker) && (
                            <div style={{ color: "var(--dim)", fontSize: "0.68rem", fontWeight: 400 }}>{twName(r.ticker)}</div>
                          )}
                        </td>
                        <td>{r.close !== null ? `${sym}${r.close.toFixed(2)}` : "—"}</td>
                        <td>{r.pm_price !== null ? `${sym}${r.pm_price.toFixed(2)}` : "—"}</td>
                        <td>{timeStr}</td>
                        <td className={chgCls}>{r.ah_change !== null ? `${r.ah_change >= 0 ? "+" : ""}${sym}${Math.abs(r.ah_change).toFixed(3)}` : "—"}</td>
                        <td className={chgCls}>{r.ah_pct !== null ? `${r.ah_pct >= 0 ? "+" : ""}${r.ah_pct.toFixed(2)}%` : "—"}</td>
                        <td className={chgCls}>{r.ah_gain !== null ? fmtMoney(r.ah_gain, currency) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Manage tab (add / edit / delete / reorder) ────────────────────────────────
function ManageTab({
  account, currency, positions,
  onRefresh, useMock,
}: {
  account: string;
  currency: Currency;
  positions: Record<string, { shares: number; avg_cost: number; total_cost?: number }>;
  onRefresh: () => void;
  useMock: boolean;
}) {
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [tickerStatus, setTickerStatus] = useState<"idle" | "checking" | "ok" | "duplicate" | "notfound">("idle");

  const [editTicker, setEditTicker] = useState<string | null>(null);
  const [editShares, setEditShares] = useState("");
  const [editTotalCost, setEditTotalCost] = useState("");

  const [showSort, setShowSort] = useState(false);

  async function handleTickerBlur() {
    const t = ticker.trim().toUpperCase();
    if (!t) { setTickerStatus("idle"); return; }
    if (positions[t]) { setTickerStatus("duplicate"); return; }
    setTickerStatus("checking");
    try {
      const { exists } = currency === "TWD" ? await api.validateTW(t) : await api.validateUS(t);
      setTickerStatus(exists ? "ok" : "notfound");
    } catch { setTickerStatus("idle"); }
  }

  async function handleAdd() {
    const t = ticker.trim().toUpperCase();
    const sh = parseFloat(shares), tc = parseFloat(totalCost);
    const missing = [...(!t ? ["代號"] : []), ...(!shares ? ["股數"] : []), ...(!totalCost ? ["總成本"] : [])];
    if (missing.length) { setErr(`請填寫：${missing.join("、")}`); return; }
    if (isNaN(sh) || sh <= 0) { setErr("股數必須為正數"); return; }
    if (isNaN(tc) || tc < 0) { setErr("總成本不可為負數"); return; }
    if (tickerStatus === "duplicate") { setErr(`${t} 已存在，請使用編輯功能更新`); return; }
    if (tickerStatus === "notfound") { setErr(`找不到代號 ${t}`); return; }
    setAdding(true); setErr("");
    try {
      if (tickerStatus !== "ok") {
        const { exists } = currency === "TWD" ? await api.validateTW(t) : await api.validateUS(t);
        if (!exists) { setErr(`找不到代號 ${t}`); setAdding(false); return; }
      }
      await api.addPosition(account, t, sh, tc / sh, tc);
      setTicker(""); setShares(""); setTotalCost(""); setTickerStatus("idle");
      onRefresh();
    } catch (e: unknown) {
      const msg = (e as Error).message;
      setErr(msg.includes("409") ? `${t} 已存在，請使用編輯功能更新` : msg);
    }
    setAdding(false);
  }

  async function handleDelete(t: string) {
    if (!confirm(`確認刪除 ${t}？`)) return;
    try { await api.deletePosition(account, t); onRefresh(); } catch { /* silent */ }
  }

  async function handleEdit(t: string) {
    const sh = parseFloat(editShares), tc = parseFloat(editTotalCost);
    if (isNaN(sh) || isNaN(tc) || sh <= 0 || tc < 0) return;
    try { await api.updatePosition(account, t, sh, tc / sh, tc); setEditTicker(null); onRefresh(); } catch { /* silent */ }
  }

  async function handleReorder(newOrder: string[]) {
    try { await api.reorderPortfolio(account, newOrder); onRefresh(); } catch { /* silent */ }
  }

  const sym = currency === "TWD" ? "NT$" : "USD";
  const tickers = Object.keys(positions);

  const manageTotalCost = Object.values(positions).reduce((s, p) => s + (p.total_cost ?? p.avg_cost * p.shares), 0);

  return (
    <div>
      {/* Total cost summary */}
      {tickers.length > 0 && (
        <div style={{ marginBottom: 16, display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: "0.65rem", color: "var(--dim)", letterSpacing: "0.08em" }}>總成本</span>
          <span style={{ fontFamily: "Courier New", fontSize: "1rem", color: "var(--text)", fontWeight: 700 }}>{fmtMoney(manageTotalCost, currency)}</span>
        </div>
      )}

      {/* Add form — hidden in demo mode */}
      {useMock ? (
        <div style={{ marginBottom: 24, fontSize: "0.72rem", color: "var(--dim)", letterSpacing: "0.06em" }}>
          ◈ read-only in demo mode
        </div>
      ) : (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: "0.72rem", color: "var(--dim)", letterSpacing: "0.08em", marginBottom: 8 }}>
            ◈ 新增持倉
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: "0.65rem", color: "var(--dim)", marginBottom: 3 }}>代號</div>
              <input className="dash-input" style={{ width: 100 }} placeholder={currency === "TWD" ? "2330" : "AAPL"}
                value={ticker}
                onChange={e => { setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9.\-]/g, "")); setTickerStatus("idle"); setErr(""); }}
                onBlur={handleTickerBlur}
                onKeyDown={e => e.key === "Enter" && handleAdd()} />
            </div>
            <div>
              <div style={{ fontSize: "0.65rem", color: "var(--dim)", marginBottom: 3 }}>股數</div>
              <input className="dash-input" style={{ width: 90 }} placeholder="100"
                type="number" value={shares} onChange={e => setShares(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()} />
            </div>
            <div>
              <div style={{ fontSize: "0.65rem", color: "var(--dim)", marginBottom: 3 }}>總成本 ({sym})</div>
              <input className="dash-input" style={{ width: 120 }} placeholder="15000.00"
                type="text" inputMode="decimal" value={totalCost}
                onChange={e => setTotalCost(e.target.value.replace(/[^0-9.]/g, ""))}
                onKeyDown={e => e.key === "Enter" && handleAdd()} />
            </div>
            <button className="dash-btn" onClick={handleAdd} disabled={adding}>
              {adding ? <span className="spinner" /> : "+ 新增"}
            </button>
          </div>
          <div style={{ minHeight: 18, marginTop: 4, fontSize: "0.72rem", whiteSpace: "nowrap" }}>
            {err ? (
              <span style={{ color: "var(--red)" }}>{err}</span>
            ) : (
              <>
                {tickerStatus === "checking"  && <span style={{ color: "var(--dim)" }}>驗證中 <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5 }} /></span>}
                {tickerStatus === "ok"        && <span style={{ color: "var(--teal)" }}>✓ 代號有效</span>}
                {tickerStatus === "duplicate" && <span style={{ color: "var(--red)" }}>{ticker} 已存在，請用編輯更新</span>}
                {tickerStatus === "notfound"  && <span style={{ color: "var(--red)" }}>找不到代號 {ticker}</span>}
              </>
            )}
          </div>
        </div>
      )}

      {/* Positions list */}
      {tickers.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="pnl-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>代號</th>
                <th>股數</th>
                <th>單股成本 ({sym})</th>
                <th>總成本 ({sym})</th>
                <th style={{ textAlign: "left", width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {tickers.map(t => {
                const pos = positions[t];
                const isEditing = editTicker === t;
                const displayAvgCost = pos.total_cost != null ? (pos.total_cost / pos.shares) : pos.avg_cost;
                const displayTotalCost = pos.total_cost ?? pos.avg_cost * pos.shares;
                return (
                  <tr key={t}>
                    <td style={{ textAlign: "left", color: "var(--teal)", fontWeight: 700 }}>
                      {t}
                      {currency === "TWD" && twName(t) && (
                        <div style={{ color: "var(--dim)", fontSize: "0.68rem", fontWeight: 400 }}>{twName(t)}</div>
                      )}
                    </td>
                    {isEditing ? (
                      <>
                        <td>
                          <input className="dash-input" style={{ width: 80 }} type="number"
                            value={editShares} onChange={e => setEditShares(e.target.value)} />
                        </td>
                        <td style={{ color: "var(--dim)", fontSize: "0.8rem" }}>
                          {(() => { const sh = parseFloat(editShares), tc = parseFloat(editTotalCost); return (!isNaN(sh) && !isNaN(tc) && sh > 0) ? (tc / sh).toFixed(3) : "—"; })()}
                        </td>
                        <td>
                          <input className="dash-input" style={{ width: 120 }} type="text" inputMode="decimal"
                            value={editTotalCost} onChange={e => setEditTotalCost(e.target.value.replace(/[^0-9.]/g, ""))} />
                        </td>
                        <td style={{ textAlign: "left" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="dash-btn dash-btn-sm" onClick={() => handleEdit(t)}>儲存</button>
                            <button className="dash-btn dash-btn-sm" onClick={() => setEditTicker(null)}>取消</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{pos.shares.toLocaleString()}</td>
                        <td style={{ color: "var(--dim)" }}>{displayAvgCost.toFixed(3)}</td>
                        <td>{displayTotalCost.toFixed(2)}</td>
                        <td style={{ textAlign: "left" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="dash-btn dash-btn-sm"
                              disabled={useMock} title={useMock ? "exit demo to edit" : undefined}
                              onClick={() => { if (!useMock) { setEditTicker(t); setEditShares(String(pos.shares)); setEditTotalCost(displayTotalCost.toFixed(2)); } }}>編輯</button>
                            <button className="dash-btn dash-btn-sm dash-btn-danger"
                              disabled={useMock} title={useMock ? "exit demo to edit" : undefined}
                              onClick={() => { if (!useMock) handleDelete(t); }}>刪除</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Reorder */}
      {tickers.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <button className="dash-btn dash-btn-sm"
            disabled={useMock} title={useMock ? "exit demo to edit" : undefined}
            onClick={() => { if (!useMock) setShowSort(s => !s); }}>
            {showSort ? "↕ 收起排序 ▲" : "↕ 調整持倉順序 ▼"}
          </button>
          {!useMock && showSort && (
            <div style={{ marginTop: 8 }}>
              <SortableChips items={tickers} onReorder={handleReorder} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Overall summary (all accounts, dynamic) ───────────────────────────────────
// Summary bar — variant "group" = teal/normal, variant "total" = gold/larger
function OverallSummaryBar({ rows, currency, label, variant = "group" }: {
  rows: PortfolioRow[]; currency: Currency; label: string; variant?: "group" | "total";
}) {
  const total     = rows.reduce((s, r) => s + (r.today_gain  ?? 0), 0);
  const unreal    = rows.reduce((s, r) => s + (r.unreal_gain ?? 0), 0);
  const cost      = rows.reduce((s, r) => s + r.cost_basis, 0);
  const mv        = rows.reduce((s, r) => s + (r.price !== null ? r.price * r.shares : 0), 0);
  const unrealPct = cost ? unreal / cost * 100 : null;
  const prevValue = rows.reduce((s, r) => s + (r.prev_close !== null ? r.prev_close * r.shares : 0), 0);
  const totalPct  = prevValue > 0 ? total / prevValue * 100 : null;

  const isTotal   = variant === "total";
  const lblClr    = isTotal ? "rgba(237,209,112,0.65)" : undefined;
  const staticClr = isTotal ? "var(--gold)" : "var(--text)";
  const valSz     = isTotal ? "1.05rem" : undefined;

  return (
    <div className="summary-bar" style={{ marginTop: 8, ...(isTotal && { borderColor: "rgba(237,209,112,0.25)", background: "rgba(237,209,112,0.05)" }) }}>
      <div style={{ display: "flex", gap: 16, borderRight: "1px solid rgba(8,120,164,0.3)", paddingRight: 24 }}>
        <div>
          <div className="summary-label" style={lblClr ? { color: lblClr } : undefined}>{label} 今日損益</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
            <div className={`summary-value ${total >= 0 ? "pos" : "neg"}`} style={valSz ? { fontSize: valSz } : undefined}>{fmtMoney(total, currency)}</div>
            {totalPct !== null && (
              <span className={totalPct >= 0 ? "pos" : "neg"} style={{ fontSize: "0.76rem", fontWeight: 600 }}>
                {totalPct >= 0 ? "+" : ""}{totalPct.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 20, borderRight: "1px solid rgba(8,120,164,0.3)", paddingRight: 24 }}>
        <div>
          <div className="summary-label" style={lblClr ? { color: lblClr } : undefined}>未實現損益</div>
          <div className={`summary-value ${unreal >= 0 ? "pos" : "neg"}`} style={valSz ? { fontSize: valSz } : undefined}>{fmtMoney(unreal, currency)}</div>
        </div>
        {unrealPct !== null && (
          <div>
            <div className="summary-label" style={lblClr ? { color: lblClr } : undefined}>未實現 %</div>
            <div className={`summary-value ${unrealPct >= 0 ? "pos" : "neg"}`}>{fmtPct(unrealPct)}</div>
          </div>
        )}
      </div>
      <div>
        <div className="summary-label" style={lblClr ? { color: lblClr } : undefined}>總成本</div>
        <div className="summary-value" style={{ color: staticClr, ...(valSz && { fontSize: valSz }) }}>{fmtMoney(cost, currency)}</div>
      </div>
      <div>
        <div className="summary-label" style={lblClr ? { color: lblClr } : undefined}>總市值</div>
        <div className="summary-value" style={{ color: staticClr, ...(valSz && { fontSize: valSz }) }}>{fmtMoney(mv, currency)}</div>
      </div>
    </div>
  );
}

// ── Sortable group row for the edit panel ─────────────────────────────────────
function SortableGroupRow({ group, idx, allAccounts, portfolio, useMock, takenAccounts, onRename, onDelete, onToggleAccount, onToggleLock }: {
  group: AccountGroup; idx: number;
  allAccounts: { key: string; currency: Currency }[];
  portfolio: Portfolio; useMock: boolean; takenAccounts: Set<string>;
  onRename: (idx: number, name: string) => void;
  onDelete: (idx: number) => void;
  onToggleAccount: (groupIdx: number, key: string, checked: boolean) => void;
  onToggleLock: (idx: number) => void;
}) {
  const [nameVal, setNameVal] = useState(group.name);
  useEffect(() => { setNameVal(group.name); }, [group.name]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.name });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const validAccts = group.accounts.filter(k => k in portfolio);
  const groupCurrencies = new Set(validAccts.map(k => (portfolio[k] as Account).currency));
  const groupCurrency: Currency | null = groupCurrencies.size === 1 ? [...groupCurrencies][0] as Currency : null;

  function commitRename() {
    const name = nameVal.trim();
    if (name && name !== group.name) onRename(idx, name);
    else setNameVal(group.name);
  }

  return (
    <div ref={setNodeRef} style={{ ...style, paddingTop: 12, paddingBottom: 12, borderBottom: "1px solid rgba(30,207,214,0.1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span {...attributes} {...listeners}
          style={{ cursor: isDragging ? "grabbing" : "grab", color: "var(--dim)", fontSize: "1rem", userSelect: "none", lineHeight: 1, touchAction: "none" }}>
          ⠿
        </span>
        <input value={nameVal} onChange={e => setNameVal(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { commitRename(); (e.target as HTMLInputElement).blur(); } }}
          disabled={useMock}
          style={{ background: "#001d3a", border: "1px solid rgba(30,207,214,0.3)", borderRadius: 4, color: "var(--text)", fontSize: "0.78rem", padding: "3px 8px", outline: "none", width: 160, fontFamily: "Courier New" }} />
        {groupCurrency && <span style={{ fontSize: "0.65rem", color: "var(--dim)", opacity: 0.6 }}>({groupCurrency})</span>}
        <LockTip text={group.locked ? "已鎖定：無法刪除此分組（點擊解鎖）" : "未鎖定：點擊鎖定以防止刪除"}>
          <button onClick={() => !useMock && onToggleLock(idx)}
            style={{ background: "none", border: "none", cursor: useMock ? "not-allowed" : "pointer", fontSize: "0.78rem", padding: "0 2px", opacity: group.locked ? 1 : 0.35, color: group.locked ? "var(--teal)" : "var(--dim)" }}>
            {group.locked ? "🔒" : "🔓"}
          </button>
        </LockTip>
        {!useMock && !group.locked && (
          <button onClick={() => onDelete(idx)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--dim)", fontSize: "0.8rem", padding: "0 2px", marginLeft: "auto" }}>
            ✕
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingLeft: 22 }}>
        {allAccounts.map(a => {
          const isChecked = group.accounts.includes(a.key);
          const inOther   = !isChecked && takenAccounts.has(a.key);
          const badCcy    = !isChecked && groupCurrency !== null && a.currency !== groupCurrency;
          const disabled  = useMock || inOther || badCcy;
          return (
            <label key={a.key} title={inOther ? "此帳戶已在其他分組中" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 5, cursor: disabled ? "not-allowed" : "pointer",
                fontSize: "0.74rem", color: isChecked ? "var(--teal)" : disabled ? "rgba(100,130,160,0.25)" : "var(--dim)" }}>
              <input type="checkbox" checked={isChecked} disabled={disabled}
                onChange={e => onToggleAccount(idx, a.key, e.target.checked)}
                style={{ accentColor: "var(--teal)", cursor: disabled ? "not-allowed" : "pointer" }} />
              {a.key}
              <span style={{ fontSize: "0.65rem", opacity: 0.5 }}>({a.currency})</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function OverallTab({ portfolio, refreshKey, useMock }: { portfolio: Portfolio; refreshKey: number; useMock: boolean }) {
  const [rowMap, setRowMap]           = useState<Record<string, PortfolioRow[]>>({});
  const [loading, setLoading]         = useState(true);
  const [savedGroups, setSavedGroups] = useState<AccountGroup[]>([]);
  const [draftGroups, setDraftGroups] = useState<AccountGroup[]>([]);
  const [isDirty, setIsDirty]         = useState(false);
  const [editOpen, setEditOpen]       = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const accounts = Object.entries(portfolio).map(([key, acct]) => ({
    key, currency: (acct as Account).currency,
  }));

  useEffect(() => {
    Promise.all(accounts.map(a => api.portfolioRows(a.key).catch(() => [] as PortfolioRow[])))
      .then(results => {
        const map: Record<string, PortfolioRow[]> = {};
        accounts.forEach((a, i) => { map[a.key] = results[i]; });
        setRowMap(map);
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio, refreshKey]);

  useEffect(() => {
    api.getSettings().then(s => {
      const groups = s.account_groups ?? [];
      setSavedGroups(groups);
      setDraftGroups(groups);
    }).catch(() => {});
  }, []);

  function markDirty(groups: AccountGroup[]) {
    setDraftGroups(groups);
    setIsDirty(true);
  }

  async function handleSave() {
    setSavedGroups(draftGroups);
    setIsDirty(false);
    await api.setSettings({ account_groups: draftGroups });
  }

  function handleCancel() {
    setDraftGroups(savedGroups);
    setIsDirty(false);
  }

  function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    setNewGroupName("");
    markDirty([...draftGroups, { name, accounts: [] }]);
  }

  function deleteGroup(idx: number) {
    markDirty(draftGroups.filter((_, i) => i !== idx));
  }

  function renameGroup(idx: number, name: string) {
    if (!name || name === draftGroups[idx]?.name) return;
    markDirty(draftGroups.map((g, i) => i === idx ? { ...g, name } : g));
  }

  function toggleAccount(groupIdx: number, acctKey: string, checked: boolean) {
    markDirty(draftGroups.map((g, i) => {
      if (i !== groupIdx) return g;
      const accts = checked ? [...g.accounts, acctKey] : g.accounts.filter(a => a !== acctKey);
      return { ...g, accounts: accts };
    }));
  }

  function toggleLock(idx: number) {
    markDirty(draftGroups.map((g, i) => i === idx ? { ...g, locked: !g.locked } : g));
  }

  const groupSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleGroupDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = draftGroups.findIndex(g => g.name === active.id);
    const newIdx = draftGroups.findIndex(g => g.name === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    markDirty(arrayMove(draftGroups, oldIdx, newIdx));
  }

  if (loading) return <div style={{ padding: 20, color: "var(--dim)" }}>載入中… <span className="spinner" /></div>;

  const usdAccts = accounts.filter(a => a.currency === "USD");
  const twdAccts = accounts.filter(a => a.currency === "TWD");
  const allUSD   = usdAccts.flatMap(a => rowMap[a.key] ?? []);
  const allTWD   = twdAccts.flatMap(a => rowMap[a.key] ?? []);

  if (!allUSD.length && !allTWD.length)
    return <div style={{ padding: 20, color: "var(--dim)", fontSize: "0.82rem" }}>尚無持倉，請先在各帳戶分頁新增。</div>;

  const sectionTitle = (t: string) => (
    <div style={{ fontFamily: "Courier New", color: "var(--gold)", fontSize: "1rem", fontWeight: 700, letterSpacing: "0.1em", margin: "12px 0 14px", borderLeft: "4px solid rgba(237,209,112,0.6)", paddingLeft: 12 }}>
      ◈ {t}
    </div>
  );

  const groupTitle = (t: string) => (
    <div style={{ fontFamily: "Courier New", color: "var(--teal)", fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.1em", margin: "8px 0 10px", borderLeft: "3px solid rgba(30,207,214,0.4)", paddingLeft: 10 }}>
      ▸ {t}
    </div>
  );

  // Groups that have accounts of a given currency (for display sectioning)
  const usdGroups = savedGroups.filter(g => g.accounts.some(k => k in portfolio && (portfolio[k] as Account).currency === "USD"));
  const twdGroups = savedGroups.filter(g => g.accounts.some(k => k in portfolio && (portfolio[k] as Account).currency === "TWD"));
  const hasGroups = usdGroups.length > 0 || twdGroups.length > 0;

  function renderSection(currency: Currency, label: string, allRows: PortfolioRow[], accts: { key: string; currency: Currency }[], groups: AccountGroup[], top: boolean) {
    if (!allRows.length) return null;
    return (
      <div style={{ marginTop: top ? 0 : 24 }}>
        {sectionTitle(label)}
        {groups.length > 0
          ? groups.map((group, gi) => {
              const relevantKeys = group.accounts.filter(k => k in portfolio && (portfolio[k] as Account).currency === currency);
              const rows = relevantKeys.flatMap(k => rowMap[k] ?? []);
              if (!rows.length) return null;
              return (
                <div key={gi} style={{ marginBottom: 20 }}>
                  {groupTitle(group.name)}
                  {relevantKeys.map(k => {
                    const krows = rowMap[k] ?? [];
                    return krows.length ? (
                      <div key={k} style={{ marginBottom: 16 }}>
                        <PnLTable rows={krows} currency={currency} label={k} />
                      </div>
                    ) : null;
                  })}
                  <OverallSummaryBar rows={rows} currency={currency} label={group.name} variant="group" />
                </div>
              );
            })
          : accts.map(a => {
              const rows = rowMap[a.key] ?? [];
              return rows.length ? (
                <div key={a.key} style={{ marginBottom: 16 }}>
                  <PnLTable rows={rows} currency={currency} label={a.key} />
                </div>
              ) : null;
            })
        }
        <OverallSummaryBar rows={allRows} currency={currency} label={`${groups.length > 0 ? label.replace(` (${currency})`, "") : label.replace(` (${currency})`, "")} 合計`} variant="total" />
        <PnLChart rows={allRows} currency={currency} />
      </div>
    );
  }

  return (
    <div>
      {/* Group management toggle */}
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => setEditOpen(v => !v)}
          style={{ background: "none", border: "1px solid rgba(30,207,214,0.3)", borderRadius: 4, cursor: "pointer", color: "var(--dim)", fontSize: "0.72rem", padding: "3px 10px" }}>
          ⚙ {editOpen ? "收起分組設定" : "管理帳號分組"}
        </button>
        {isDirty && !editOpen && (
          <span style={{ fontSize: "0.72rem", color: "rgba(237,209,112,0.7)" }}>● 有未儲存的變更</span>
        )}
      </div>

      {editOpen && (
        <div style={{ background: "rgba(0,24,40,0.8)", border: "1px solid rgba(30,207,214,0.2)", borderRadius: 6, padding: 16, marginBottom: 20 }}>
          {draftGroups.length === 0 && (
            <div style={{ color: "var(--dim)", fontSize: "0.75rem", marginBottom: 12 }}>尚無分組，點擊下方新增第一個分組。</div>
          )}

          <DndContext sensors={groupSensors} collisionDetection={closestCenter} onDragEnd={handleGroupDragEnd}>
            <SortableContext items={draftGroups.map(g => g.name)} strategy={verticalListSortingStrategy}>
              {draftGroups.map((group, gi) => {
                const takenAccounts = new Set(draftGroups.flatMap((g, i) => i !== gi ? g.accounts : []));
                return (
                  <SortableGroupRow
                    key={gi}
                    group={group} idx={gi}
                    allAccounts={accounts}
                    portfolio={portfolio}
                    useMock={useMock}
                    takenAccounts={takenAccounts}
                    onRename={renameGroup}
                    onDelete={deleteGroup}
                    onToggleAccount={toggleAccount}
                    onToggleLock={toggleLock}
                  />
                );
              })}
            </SortableContext>
          </DndContext>

          {!useMock && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && addGroup()}
                placeholder="新分組名稱…"
                style={{ background: "#001d3a", border: "1px solid rgba(30,207,214,0.3)", borderRadius: 4, color: "var(--text)", fontSize: "0.78rem", padding: "3px 8px", outline: "none", width: 160, fontFamily: "Courier New" }}
              />
              <button onClick={addGroup}
                style={{ background: "none", border: "1px solid rgba(30,207,214,0.4)", borderRadius: 4, cursor: "pointer", color: "var(--teal)", fontSize: "0.78rem", padding: "3px 10px" }}>
                ＋ 新增分組
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(30,207,214,0.15)" }}>
            <button onClick={handleSave} disabled={!isDirty || useMock}
              style={{
                background: isDirty && !useMock ? "rgba(30,207,214,0.15)" : "none",
                border: `1px solid ${isDirty && !useMock ? "rgba(30,207,214,0.5)" : "rgba(30,207,214,0.15)"}`,
                borderRadius: 4, cursor: isDirty && !useMock ? "pointer" : "not-allowed",
                color: isDirty && !useMock ? "var(--teal)" : "var(--dim)",
                fontSize: "0.78rem", padding: "4px 14px", fontFamily: "Courier New",
              }}>
              儲存
            </button>
            <button onClick={handleCancel} disabled={!isDirty}
              style={{
                background: "none",
                border: `1px solid ${isDirty ? "rgba(200,100,80,0.4)" : "rgba(100,100,100,0.2)"}`,
                borderRadius: 4, cursor: isDirty ? "pointer" : "not-allowed",
                color: isDirty ? "rgba(200,120,100,0.9)" : "var(--dim)",
                fontSize: "0.78rem", padding: "4px 14px", fontFamily: "Courier New",
              }}>
              取消
            </button>
          </div>
        </div>
      )}

      {renderSection("USD", "美股市場 (USD)", allUSD, usdAccts, usdGroups, true)}
      {renderSection("TWD", "台股市場 (TWD)", allTWD, twdAccts, twdGroups, !allUSD.length)}
    </div>
  );
}

// ── Sortable account tab button ───────────────────────────────────────────────
function SortableAcctTab({ id, label, isActive, isProtected, isRenaming, useMock, renameValue,
  onActivate, onDoubleClick, onDelete, onRenameChange, onRenameBlur, onRenameKeyDown,
}: {
  id: string; label: string; isActive: boolean; isProtected: boolean; isRenaming: boolean; useMock: boolean;
  renameValue: string;
  onActivate: () => void; onDoubleClick: () => void; onDelete: () => void;
  onRenameChange: (v: string) => void; onRenameBlur: () => void; onRenameKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={{ ...style, position: "relative", display: "inline-flex", alignItems: "center" }} {...attributes}>
      {isRenaming ? (
        <input autoFocus value={renameValue} onChange={e => onRenameChange(e.target.value)}
          onBlur={onRenameBlur} onKeyDown={onRenameKeyDown}
          style={{ fontSize: "0.78rem", fontFamily: "Courier New", background: "#001d3a", border: "1px solid var(--teal)", color: "var(--teal)", borderRadius: 4, padding: "3px 8px", outline: "none", width: 180 }} />
      ) : (
        <button className={`tab-btn${isActive ? " active" : ""}`}
          onClick={onActivate} onDoubleClick={onDoubleClick}
          title="拖曳可排序"
          {...listeners}
          style={{ cursor: isDragging ? "grabbing" : "grab" }}>
          {label}
        </button>
      )}
      {isActive && !useMock && !isRenaming && !isProtected && (
        <button onClick={onDelete} title="刪除帳戶"
          style={{ marginLeft: 2, background: "none", border: "none", cursor: "pointer", color: "var(--dim)", fontSize: "0.7rem", padding: "0 2px" }}>
          ✕
        </button>
      )}
    </div>
  );
}

// ── Main portfolio tab ────────────────────────────────────────────────────────
export function PortfolioTab({ refreshKey, useMock }: { refreshKey: number; useMock: boolean }) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [acctTab, setAcctTab] = useState(0);
  const [pnlTab, setPnlTab] = useState(0);
  const [addingAccount, setAddingAccount] = useState(false);
  const [newAcctName, setNewAcctName] = useState("");
  const [newAcctCurrency, setNewAcctCurrency] = useState<Currency>("USD");
  const [renamingAcct, setRenamingAcct] = useState<string | null>(null);
  const [renameAcctValue, setRenameAcctValue] = useState("");
  const [protectedAccounts, setProtectedAccounts] = useState<Set<string>>(new Set());

  const acctSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    const a = parseInt(sessionStorage.getItem("portfolio-acct-tab") ?? "0", 10) || 0;
    if (a > 0) setAcctTab(a);
    api.getSettings().then(s => {
      if (s.protected_accounts) setProtectedAccounts(new Set(s.protected_accounts));
    }).catch(() => {});
  }, []);

  const loadPortfolio = useCallback(async () => {
    try {
      const p = await api.portfolio();
      setPortfolio(p);
      setAllAccountKeys(Object.keys(p));
    } catch { /* silent */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => { loadPortfolio(); }, [loadPortfolio]);

  function toggleProtect(key: string) {
    setProtectedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      api.setSettings({ protected_accounts: [...next] }).catch(() => {});
      return next;
    });
  }

  if (!portfolio) return <div style={{ padding: 20, color: "var(--dim)" }}>載入中… <span className="spinner" /></div>;

  // Derive accounts dynamically from portfolio
  const ACCOUNTS = Object.entries(portfolio).map(([key, acct]) => ({
    key,
    label: `${(acct as { currency: Currency }).currency === "TWD" ? "🇹🇼" : "🇺🇸"} ${key}`,
    currency: (acct as { currency: Currency }).currency,
  }));

  async function handleCreateAccount() {
    const name = newAcctName.trim();
    if (!name) return;
    try {
      await api.createAccount(name, newAcctCurrency);
      await loadPortfolio();
      setAcctTab(ACCOUNTS.length + 1); // new account becomes last tab
    } catch { /* silent */ }
    setNewAcctName(""); setAddingAccount(false);
  }

  async function handleRenameAccount() {
    if (!renamingAcct) return;
    const newName = renameAcctValue.trim();
    if (!newName || newName === renamingAcct) { setRenamingAcct(null); return; }
    try {
      await api.renameAccount(renamingAcct, newName);
      await loadPortfolio();
      // acctTab index unchanged (position preserved)
    } catch { /* silent */ }
    setRenamingAcct(null);
  }

  async function handleDeleteAccount(key: string) {
    const positions = portfolio?.[key]?.positions ?? {};
    if (Object.keys(positions).length > 0) {
      alert("請先移除所有持倉才能刪除帳戶");
      return;
    }
    if (!window.confirm(`刪除帳戶「${key}」？`)) return;
    try {
      await api.deleteAccount(key);
      await loadPortfolio();
      setAcctTab(0);
    } catch (e: unknown) {
      alert((e as Error).message);
    }
  }

  function handleReorderAccounts(newOrder: string[]) {
    // Optimistic update: reorder local state immediately for smooth animation
    const activeKey = ACCOUNTS[acctTab - 1]?.key;
    setPortfolio(prev => {
      if (!prev) return prev;
      return Object.fromEntries(newOrder.map(k => [k, prev[k]])) as Portfolio;
    });
    if (activeKey) {
      const newIdx = newOrder.indexOf(activeKey);
      if (newIdx !== -1) { setAcctTab(newIdx + 1); sessionStorage.setItem("portfolio-acct-tab", String(newIdx + 1)); }
    }
    // Sync to backend silently
    api.reorderAccounts(newOrder).catch(() => loadPortfolio());
  }

  return (
    <div>
      {/* Account tabs */}
      <div className="tab-bar" style={{ flexWrap: "wrap", gap: 4 }}>
        <button className={`tab-btn${acctTab === 0 ? " active" : ""}`} onClick={() => { setAcctTab(0); sessionStorage.setItem("portfolio-acct-tab", "0"); }}>
          📊 整體損益
        </button>
        <div style={{ width: 1, background: "rgba(30,207,214,0.25)", alignSelf: "stretch", margin: "2px 4px" }} />
        <DndContext sensors={acctSensors} collisionDetection={closestCenter} onDragEnd={(event: DragEndEvent) => {
          const { active, over } = event;
          if (over && active.id !== over.id) {
            const keys = ACCOUNTS.map(a => a.key);
            const oldIdx = keys.indexOf(active.id as string);
            const newIdx = keys.indexOf(over.id as string);
            handleReorderAccounts(arrayMove(keys, oldIdx, newIdx));
          }
        }}>
          <SortableContext items={ACCOUNTS.map(a => a.key)} strategy={horizontalListSortingStrategy}>
            <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
              {ACCOUNTS.map((acct, i) => (
                <SortableAcctTab key={acct.key} id={acct.key} label={acct.label}
                  isActive={acctTab === i + 1}
                  isProtected={protectedAccounts.has(acct.key)}
                  isRenaming={renamingAcct === acct.key}
                  useMock={useMock}
                  renameValue={renameAcctValue}
                  onActivate={() => { setAcctTab(i + 1); sessionStorage.setItem("portfolio-acct-tab", String(i + 1)); }}
                  onDoubleClick={() => { if (!useMock) { setRenamingAcct(acct.key); setRenameAcctValue(acct.key); } }}
                  onDelete={() => handleDeleteAccount(acct.key)}
                  onRenameChange={v => setRenameAcctValue(v)}
                  onRenameBlur={handleRenameAccount}
                  onRenameKeyDown={e => { if (e.key === "Enter") handleRenameAccount(); if (e.key === "Escape") setRenamingAcct(null); }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {/* Add account button */}
        {!useMock && (
          addingAccount ? (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input
                autoFocus
                value={newAcctName}
                onChange={e => setNewAcctName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreateAccount(); if (e.key === "Escape") setAddingAccount(false); }}
                placeholder="帳戶名稱"
                style={{ fontSize: "0.78rem", fontFamily: "Courier New", background: "#001d3a", border: "1px solid var(--teal)", color: "var(--teal)", borderRadius: 4, padding: "3px 8px", outline: "none", width: 140 }}
              />
              <select value={newAcctCurrency} onChange={e => setNewAcctCurrency(e.target.value as Currency)}
                style={{ fontSize: "0.75rem", fontFamily: "Courier New", background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)", color: "var(--text)", borderRadius: 4, padding: "3px 6px" }}>
                <option value="USD">美股 (USD)</option>
                <option value="TWD">台股 (TWD)</option>
              </select>
              <button className="dash-btn dash-btn-sm" onClick={handleCreateAccount}>新增</button>
              <button className="dash-btn dash-btn-sm" onClick={() => setAddingAccount(false)}>取消</button>
            </div>
          ) : (
            <button className="dash-btn dash-btn-sm" onClick={() => setAddingAccount(true)} style={{ fontSize: "0.72rem" }}>＋ 新增帳戶</button>
          )
        )}
      </div>

      {acctTab === 0 && <OverallTab portfolio={portfolio} refreshKey={refreshKey} useMock={useMock} />}

      {ACCOUNTS.map((acct, i) => {
        const isActive = acctTab === i + 1;
        const isProtected = protectedAccounts.has(acct.key);
        return (
          <div key={acct.key} style={isActive ? {} : { visibility: "hidden", height: 0, overflow: "hidden" }}>
            <div className="tab-bar" style={{ alignItems: "center" }}>
              {["💰 今日損益", "📝 持倉管理"].map((t, ti) => (
                <button key={t} className={`tab-btn${pnlTab === ti ? " active" : ""}`} onClick={() => {
                    setPnlTab(ti);
                    sessionStorage.setItem(`portfolio-pnl-tab-${i + 1}`, String(ti));
                  }}>
                  {t}
                </button>
              ))}
              {!useMock && (
                <LockTip text={isProtected ? "已鎖定：無法刪除此帳戶（點擊解鎖）" : "未鎖定：點擊鎖定以防止刪除"}>
                  <button onClick={() => toggleProtect(acct.key)}
                    style={{ background: "none", border: "none", cursor: "pointer",
                      fontSize: "0.78rem", padding: "0 4px", opacity: isProtected ? 1 : 0.35,
                      color: isProtected ? "var(--teal)" : "var(--dim)" }}>
                    {isProtected ? "🔒" : "🔓"}
                  </button>
                </LockTip>
              )}
            </div>
            <div style={{ display: isActive && pnlTab === 1 ? "none" : "block" }}>
              <AccountPnL account={acct.key} currency={acct.currency} refreshKey={refreshKey} />
            </div>
            {isActive && pnlTab === 1 && (
              <ManageTab
                account={acct.key}
                currency={acct.currency}
                positions={portfolio[acct.key]?.positions ?? {}}
                onRefresh={loadPortfolio}
                useMock={useMock}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
