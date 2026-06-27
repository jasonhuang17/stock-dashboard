"use client";
import { useState, useEffect, useCallback } from "react";
import { api, fmtMoney, fmtPct } from "@/lib/api";
import type { PortfolioRow, PremarketPortfolioRow, Portfolio } from "@/lib/types";
import { twName } from "@/lib/tw-names";
import { PnLTable } from "./PnLTable";
import { PnLChart } from "./PnLChart";
import { SortableChips } from "./SortableChips";

type Currency = "USD" | "TWD";

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
  const todayPct = prevMV ? totalToday / prevMV * 100 : null;
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
          <div>
            <div className="summary-label">今日損益</div>
            <div className={`summary-value ${totalToday >= 0 ? "pos" : "neg"}`}>{fmtMoney(totalToday, currency)}</div>
          </div>
          {todayPct !== null && (
            <div>
              <div className="summary-label">今日 %</div>
              <div className={`summary-value ${todayPct >= 0 ? "pos" : "neg"}`}>{fmtPct(todayPct)}</div>
            </div>
          )}
          <div>
            <div className="summary-label">未實現損益</div>
            <div className={`summary-value ${totalUnreal >= 0 ? "pos" : "neg"}`}>{fmtMoney(totalUnreal, currency)}</div>
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
      <PnLTable rows={rows} currency={currency} />
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
  onRefresh,
}: {
  account: string;
  currency: Currency;
  positions: Record<string, { shares: number; avg_cost: number; total_cost?: number }>;
  onRefresh: () => void;
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
    if (isNaN(tc) || tc <= 0) { setErr("總成本必須為正數"); return; }
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
    if (isNaN(sh) || isNaN(tc) || sh <= 0 || tc <= 0) return;
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

      {/* Add form */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: "0.72rem", color: "var(--dim)", letterSpacing: "0.08em", marginBottom: 8 }}>
          ◈ 新增持倉
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: "0.65rem", color: "var(--dim)", marginBottom: 3 }}>代號</div>
            <input className="dash-input" style={{ width: 100 }} placeholder={currency === "TWD" ? "2330" : "AAPL"}
              value={ticker}
              onChange={e => { setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9.]/g, "")); setTickerStatus("idle"); setErr(""); }}
              onBlur={handleTickerBlur}
              onKeyDown={e => e.key === "Enter" && handleAdd()} />
            <div style={{ position: "absolute", top: "100%", left: 0, paddingTop: 2, whiteSpace: "nowrap" }}>
              {tickerStatus === "checking"  && <span style={{ fontSize: "0.6rem", color: "var(--dim)" }}>驗證中 <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5 }} /></span>}
              {tickerStatus === "ok"        && <span style={{ fontSize: "0.6rem", color: "var(--teal)" }}>✓ 代號有效</span>}
              {tickerStatus === "duplicate" && <span style={{ fontSize: "0.6rem", color: "var(--red)" }}>{ticker} 已存在，請用編輯更新</span>}
              {tickerStatus === "notfound"  && <span style={{ fontSize: "0.6rem", color: "var(--red)" }}>找不到代號 {ticker}</span>}
            </div>
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
              type="number" step="0.01" value={totalCost}
              onChange={e => setTotalCost(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()} />
          </div>
          <button className="dash-btn" onClick={handleAdd} disabled={adding} style={{ marginBottom: 0, alignSelf: "flex-end" }}>
            {adding ? <span className="spinner" /> : "+ 新增"}
          </button>
        </div>
        {err && <div style={{ color: "var(--red)", fontSize: "0.75rem", marginTop: 6 }}>{err}</div>}
      </div>

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
                          <input className="dash-input" style={{ width: 120 }} type="number" step="0.01"
                            value={editTotalCost} onChange={e => setEditTotalCost(e.target.value)} />
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
                            <button className="dash-btn dash-btn-sm" onClick={() => {
                              setEditTicker(t);
                              setEditShares(String(pos.shares));
                              setEditTotalCost(displayTotalCost.toFixed(2));
                            }}>編輯</button>
                            <button className="dash-btn dash-btn-sm dash-btn-danger" onClick={() => handleDelete(t)}>刪除</button>
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
          <button className="dash-btn dash-btn-sm" onClick={() => setShowSort(s => !s)}>
            {showSort ? "↕ 收起排序 ▲" : "↕ 調整持倉順序 ▼"}
          </button>
          {showSort && (
            <div style={{ marginTop: 8 }}>
              <SortableChips items={tickers} onReorder={handleReorder} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Overall summary (all accounts) ───────────────────────────────────────────
function OverallTab({ portfolio, refreshKey }: { portfolio: Portfolio; refreshKey: number }) {
  const [usdRowsTW, setUsdRowsTW] = useState<PortfolioRow[]>([]);
  const [usdRowsUS, setUsdRowsUS] = useState<PortfolioRow[]>([]);
  const [twdRows, setTwdRows] = useState<PortfolioRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.portfolioRows("複委託（台幣戶）"),
      api.portfolioRows("複委託（美金戶）"),
      api.portfolioRows("台股帳戶"),
    ]).then(([tw, us, twd]) => {
      setUsdRowsTW(tw);
      setUsdRowsUS(us);
      setTwdRows(twd);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [portfolio, refreshKey]);

  if (loading) return <div style={{ padding: 20, color: "var(--dim)" }}>載入中… <span className="spinner" /></div>;

  const allUSD = [...usdRowsTW, ...usdRowsUS];
  const usdTotal = allUSD.reduce((s, r) => s + (r.today_gain ?? 0), 0);
  const usdUnreal = allUSD.reduce((s, r) => s + (r.unreal_gain ?? 0), 0);
  const twdTotal = twdRows.reduce((s, r) => s + (r.today_gain ?? 0), 0);
  const twdUnreal = twdRows.reduce((s, r) => s + (r.unreal_gain ?? 0), 0);

  const noData = !allUSD.length && !twdRows.length;
  if (noData) return <div style={{ padding: 20, color: "var(--dim)", fontSize: "0.82rem" }}>尚無持倉，請先在各帳戶分頁新增。</div>;

  const sectionTitle = (t: string) => (
    <div style={{ fontFamily: "Courier New", color: "var(--gold)", fontSize: "0.82rem", fontWeight: 700, letterSpacing: "0.12em", margin: "8px 0 12px", borderLeft: "3px solid rgba(237,209,112,0.4)", paddingLeft: 10 }}>
      ◈ {t}
    </div>
  );

  return (
    <div>
      {allUSD.length > 0 && (
        <div>
          {sectionTitle("美股市場 (USD)")}
          {usdRowsTW.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: "0.7rem", color: "var(--dim)", letterSpacing: "0.08em", marginBottom: 8 }}>複委託（台幣戶）</div>
              <PnLTable rows={usdRowsTW} currency="USD" />
            </div>
          )}
          {usdRowsUS.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: "0.7rem", color: "var(--dim)", letterSpacing: "0.08em", marginBottom: 8 }}>複委託（美金戶）</div>
              <PnLTable rows={usdRowsUS} currency="USD" />
            </div>
          )}
          <div className="summary-bar" style={{ marginTop: 8 }}>
            <div>
              <div className="summary-label">美股今日合計</div>
              <div className={`summary-value ${usdTotal >= 0 ? "pos" : "neg"}`}>{fmtMoney(usdTotal, "USD")}</div>
            </div>
            <div>
              <div className="summary-label">未實現合計</div>
              <div className={`summary-value ${usdUnreal >= 0 ? "pos" : "neg"}`}>{fmtMoney(usdUnreal, "USD")}</div>
            </div>
          </div>
          <PnLChart rows={allUSD} currency="USD" />
        </div>
      )}

      {twdRows.length > 0 && (
        <div style={{ marginTop: allUSD.length ? 24 : 0 }}>
          {sectionTitle("台股市場 (TWD)")}
          <PnLTable rows={twdRows} currency="TWD" />
          <div className="summary-bar" style={{ marginTop: 8 }}>
            <div>
              <div className="summary-label">台股今日合計</div>
              <div className={`summary-value ${twdTotal >= 0 ? "pos" : "neg"}`}>{fmtMoney(twdTotal, "TWD")}</div>
            </div>
            <div>
              <div className="summary-label">未實現合計</div>
              <div className={`summary-value ${twdUnreal >= 0 ? "pos" : "neg"}`}>{fmtMoney(twdUnreal, "TWD")}</div>
            </div>
          </div>
          <PnLChart rows={twdRows} currency="TWD" />
        </div>
      )}
    </div>
  );
}

// ── Main portfolio tab ────────────────────────────────────────────────────────
export function PortfolioTab({ refreshKey }: { refreshKey: number }) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [acctTab, setAcctTab] = useState(0);
  const [pnlTab, setPnlTab] = useState(0);

  useEffect(() => {
    const a = parseInt(sessionStorage.getItem("portfolio-acct-tab") ?? "0", 10) || 0;
    if (a > 0) {
      setAcctTab(a);
      const p = parseInt(sessionStorage.getItem(`portfolio-pnl-tab-${a}`) ?? "0", 10) || 0;
      if (p > 0) setPnlTab(p);
    }
  }, []);

  const ACCOUNTS: { key: string; label: string; currency: Currency }[] = [
    { key: "複委託（台幣戶）", label: "🏦 複委託（台幣戶）", currency: "USD" },
    { key: "複委託（美金戶）", label: "🏦 複委託（美金戶）", currency: "USD" },
    { key: "台股帳戶",         label: "🇹🇼 台股帳戶",        currency: "TWD" },
  ];

  const loadPortfolio = useCallback(async () => {
    try { setPortfolio(await api.portfolio()); } catch { /* silent */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => { loadPortfolio(); }, [loadPortfolio]);

  if (!portfolio) return <div style={{ padding: 20, color: "var(--dim)" }}>載入中… <span className="spinner" /></div>;

  const acctTabs = [{ key: "_overall", label: "📊 整體損益" }, ...ACCOUNTS];
  const cur = acctTab > 0 ? ACCOUNTS[acctTab - 1] : null;
  const pnlSubTabs = cur ? ["💰 今日損益", "📝 持倉管理"] : [];

  return (
    <div>
      {/* Account tabs */}
      <div className="tab-bar">
        {acctTabs.map((a, i) => (
          <button key={a.key} className={`tab-btn${acctTab === i ? " active" : ""}`} onClick={() => {
              const p = parseInt(sessionStorage.getItem(`portfolio-pnl-tab-${i}`) ?? "0", 10) || 0;
              setAcctTab(i); setPnlTab(p);
              sessionStorage.setItem("portfolio-acct-tab", String(i));
            }}>
            {a.label}
          </button>
        ))}
      </div>

      {acctTab === 0 && <OverallTab portfolio={portfolio} refreshKey={refreshKey} />}

      {ACCOUNTS.map((acct, i) => {
        const isActive = acctTab === i + 1;
        return (
          <div key={acct.key} style={isActive ? {} : { visibility: "hidden", height: 0, overflow: "hidden" }}>
            <div className="tab-bar">
              {["💰 今日損益", "📝 持倉管理"].map((t, ti) => (
                <button key={t} className={`tab-btn${pnlTab === ti ? " active" : ""}`} onClick={() => {
                    setPnlTab(ti);
                    sessionStorage.setItem(`portfolio-pnl-tab-${i + 1}`, String(ti));
                  }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Always mounted — hidden by parent when inactive; hidden by display when Manage is active */}
            <div style={{ display: isActive && pnlTab === 1 ? "none" : "block" }}>
              <AccountPnL account={acct.key} currency={acct.currency} refreshKey={refreshKey} />
            </div>

            {isActive && pnlTab === 1 && (
              <ManageTab
                account={acct.key}
                currency={acct.currency}
                positions={portfolio[acct.key]?.positions ?? {}}
                onRefresh={loadPortfolio}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
