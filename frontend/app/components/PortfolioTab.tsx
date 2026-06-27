"use client";
import { useState, useEffect, useCallback } from "react";
import { api, fmtMoney, fmtPct } from "@/lib/api";
import type { PortfolioRow, PremarketPortfolioRow, Portfolio } from "@/lib/types";
import { PnLTable } from "./PnLTable";
import { PnLChart } from "./PnLChart";
import { SortableChips } from "./SortableChips";

type Currency = "USD" | "TWD";

// ── Per-account P&L tab ───────────────────────────────────────────────────────
function AccountPnL({ account, currency, refreshKey }: { account: string; currency: Currency; refreshKey: number }) {
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [ahRows, setAhRows] = useState<PremarketPortfolioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAH, setShowAH] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const [r, ah] = await Promise.all([
        api.portfolioRows(account),
        api.portfolioPremarketRows(account),
      ]);
      setRows(r);
      setAhRows(ah);
    } catch { /* silent */ }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, refreshKey]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const totalToday  = rows.reduce((s, r) => s + (r.today_gain ?? 0), 0);
  const totalUnreal = rows.reduce((s, r) => s + (r.unreal_gain ?? 0), 0);
  const totalMV     = rows.reduce((s, r) => s + ((r.price ?? 0) * r.shares), 0);
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
        <div className="summary-bar">
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
                        <td style={{ textAlign: "left", color: "var(--teal)", fontWeight: 700 }}>{r.ticker}</td>
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
  positions: Record<string, { shares: number; avg_cost: number }>;
  onRefresh: () => void;
}) {
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [cost, setCost] = useState("");
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);

  const [editTicker, setEditTicker] = useState<string | null>(null);
  const [editShares, setEditShares] = useState("");
  const [editCost, setEditCost] = useState("");

  const [showSort, setShowSort] = useState(false);

  async function handleAdd() {
    const t = ticker.trim().toUpperCase();
    if (!t || !shares || !cost) { setErr("欄位不得為空"); return; }
    const sh = parseFloat(shares), av = parseFloat(cost);
    if (isNaN(sh) || isNaN(av) || sh <= 0 || av <= 0) { setErr("股數/成本必須為正數"); return; }
    setAdding(true); setErr("");
    try {
      const validate = currency === "TWD" ? api.validateTW(t) : api.validateUS(t);
      const { exists } = await validate;
      if (!exists) { setErr(`找不到代號 ${t}`); setAdding(false); return; }
      await api.addPosition(account, t, sh, av);
      setTicker(""); setShares(""); setCost("");
      onRefresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    setAdding(false);
  }

  async function handleDelete(t: string) {
    if (!confirm(`確認刪除 ${t}？`)) return;
    try { await api.deletePosition(account, t); onRefresh(); } catch { /* silent */ }
  }

  async function handleEdit(t: string) {
    const sh = parseFloat(editShares), av = parseFloat(editCost);
    if (isNaN(sh) || isNaN(av) || sh <= 0 || av <= 0) return;
    try { await api.updatePosition(account, t, sh, av); setEditTicker(null); onRefresh(); } catch { /* silent */ }
  }

  async function handleReorder(newOrder: string[]) {
    try { await api.reorderPortfolio(account, newOrder); onRefresh(); } catch { /* silent */ }
  }

  const sym = currency === "TWD" ? "NT$" : "USD";
  const tickers = Object.keys(positions);

  return (
    <div>
      {/* Add form */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: "0.72rem", color: "var(--dim)", letterSpacing: "0.08em", marginBottom: 8 }}>
          ◈ 新增持倉
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: "0.65rem", color: "var(--dim)", marginBottom: 3 }}>代號</div>
            <input className="dash-input" style={{ width: 100 }} placeholder={currency === "TWD" ? "2330" : "AAPL"}
              value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && handleAdd()} />
          </div>
          <div>
            <div style={{ fontSize: "0.65rem", color: "var(--dim)", marginBottom: 3 }}>股數</div>
            <input className="dash-input" style={{ width: 90 }} placeholder="100"
              type="number" value={shares} onChange={e => setShares(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()} />
          </div>
          <div>
            <div style={{ fontSize: "0.65rem", color: "var(--dim)", marginBottom: 3 }}>平均成本 ({sym})</div>
            <input className="dash-input" style={{ width: 110 }} placeholder="150.00"
              type="number" step="0.01" value={cost} onChange={e => setCost(e.target.value)}
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
                <th>平均成本 ({sym})</th>
                <th style={{ textAlign: "left", width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {tickers.map(t => {
                const pos = positions[t];
                const isEditing = editTicker === t;
                return (
                  <tr key={t}>
                    <td style={{ textAlign: "left", color: "var(--teal)", fontWeight: 700 }}>{t}</td>
                    {isEditing ? (
                      <>
                        <td>
                          <input className="dash-input" style={{ width: 80 }} type="number"
                            value={editShares} onChange={e => setEditShares(e.target.value)} />
                        </td>
                        <td>
                          <input className="dash-input" style={{ width: 100 }} type="number" step="0.01"
                            value={editCost} onChange={e => setEditCost(e.target.value)} />
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
                        <td>{pos.avg_cost.toFixed(2)}</td>
                        <td style={{ textAlign: "left" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="dash-btn dash-btn-sm" onClick={() => {
                              setEditTicker(t);
                              setEditShares(String(pos.shares));
                              setEditCost(String(pos.avg_cost));
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

  const ACCOUNTS: { key: string; label: string; currency: Currency }[] = [
    { key: "複委託（台幣戶）", label: "🏦 複委託（台幣戶）", currency: "USD" },
    { key: "複委託（美金戶）", label: "🏦 複委託（美金戶）", currency: "USD" },
    { key: "台股帳戶",         label: "🇹🇼 台股帳戶",        currency: "TWD" },
  ];

  const loadPortfolio = useCallback(async () => {
    try { setPortfolio(await api.portfolio()); } catch { /* silent */ }
  }, []);

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
          <button key={a.key} className={`tab-btn${acctTab === i ? " active" : ""}`} onClick={() => { setAcctTab(i); setPnlTab(0); }}>
            {a.label}
          </button>
        ))}
      </div>

      {acctTab === 0 && <OverallTab portfolio={portfolio} refreshKey={refreshKey} />}

      {cur && (
        <div>
          <div className="tab-bar">
            {pnlSubTabs.map((t, i) => (
              <button key={t} className={`tab-btn${pnlTab === i ? " active" : ""}`} onClick={() => setPnlTab(i)}>
                {t}
              </button>
            ))}
          </div>

          {pnlTab === 0 && <AccountPnL account={cur.key} currency={cur.currency} refreshKey={refreshKey} />}
          {pnlTab === 1 && (
            <ManageTab
              account={cur.key}
              currency={cur.currency}
              positions={portfolio[cur.key]?.positions ?? {}}
              onRefresh={loadPortfolio}
            />
          )}
        </div>
      )}
    </div>
  );
}
