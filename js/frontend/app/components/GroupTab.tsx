"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { Quote, PremarketQuote, Market } from "@/lib/types";
import { StockCard, PremarketCard } from "./StockCard";
import { GroupStats, GroupCharts } from "./GroupCharts";
import { SortableChips } from "./SortableChips";

type SubTab = "cards" | "pie" | "bar" | "premarket";

interface Props {
  groupName: string;
  tickers: string[];
  market: Market;
  refreshKey: number;
  useMock: boolean;
  isPinned: boolean;
  onTickersChange: (tickers: string[]) => void;
  onTogglePin: () => void;
}

export function GroupTab({ groupName, tickers, market, refreshKey, useMock, isPinned, onTickersChange, onTogglePin }: Props) {
  const [subTab, setSubTab] = useState<SubTab>("cards");

  useEffect(() => {
    const saved = sessionStorage.getItem(`group-subtab-${groupName}`) as SubTab | null;
    if (saved) setSubTab(saved);
  }, [groupName]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [premarket, setPremarket] = useState<PremarketQuote[]>([]);
  const [loading, setLoading] = useState(true);

  const [sortMode, setSortMode] = useState<"custom" | "pct_desc" | "pct_asc" | "alpha" | "price_desc">("custom");

  useEffect(() => {
    api.getSettings().then(s => {
      const saved = s.group_sorts?.[groupName];
      if (saved) setSortMode(saved as typeof sortMode);
    }).catch(() => {});
  }, [groupName]);

  const [showSort, setShowSort] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  // Use join() as the dependency so a new array reference with the same content
  // (caused by the parent's countdown re-render) doesn't trigger a new fetch.
  const tickersSig = tickers.join(",");

  const fetchData = useCallback(async () => {
    if (!tickers.length) { setQuotes([]); setPremarket([]); setLoading(false); return; }
    try {
      const [q, pm] = await Promise.all([
        api.quotes(tickers, market),
        api.premarket(tickers),
      ]);
      setQuotes(q);
      setPremarket(pm);
    } catch { /* silent */ }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickersSig, refreshKey, market]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function sorted(qs: Quote[]): Quote[] {
    if (sortMode === "custom") return qs;
    const order = [...qs];
    if (sortMode === "pct_desc") return order.sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity));
    if (sortMode === "pct_asc")  return order.sort((a, b) => (a.pct ?? Infinity) - (b.pct ?? Infinity));
    if (sortMode === "alpha")    return order.sort((a, b) => a.ticker.localeCompare(b.ticker));
    if (sortMode === "price_desc") return order.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    return order;
  }

  async function handleAdd() {
    const t = addInput.trim().toUpperCase();
    if (!t) { setAddError("請輸入代號"); return; }
    setAdding(true);
    setAddError("");
    try {
      if (market === "TW") {
        const { exists } = await api.validateTW(t);
        if (!exists) { setAddError(`找不到台股代號 ${t}`); setAdding(false); return; }
      } else {
        const { exists } = await api.validateUS(t);
        if (!exists) { setAddError(`找不到代號 ${t}`); setAdding(false); return; }
      }
      const res = await api.addGroupTicker(groupName, t);
      onTickersChange(res.tickers);
      setAddInput("");
      setShowAdd(false);
    } catch (e: unknown) {
      setAddError((e as Error).message);
    }
    setAdding(false);
  }

  async function handleRemove(ticker: string) {
    try {
      const res = await api.removeGroupTicker(groupName, ticker);
      onTickersChange(res.tickers);
    } catch { /* silent */ }
  }

  async function handleReorder(newOrder: string[]) {
    try {
      const res = await api.reorderGroup(groupName, newOrder);
      onTickersChange(res.tickers);
    } catch { /* silent */ }
  }

  const cols = tickers.length <= 3 ? tickers.length : tickers.length <= 6 ? 3 : 4;
  const displayQuotes = sorted(quotes.length ? quotes : tickers.map(t => ({ ticker: t, price: null, pct: null })));
  const pmMap = Object.fromEntries(premarket.map(p => [p.ticker, p]));

  const subTabs: { key: SubTab; label: string }[] = [
    { key: "cards",     label: "📋 Cards" },
    { key: "pie",       label: "🥧 圓餅圖" },
    { key: "bar",       label: "📊 長條圖" },
    { key: "premarket", label: "🌅 盤前/後" },
  ];

  return (
    <div>
      {/* Sub-tabs */}
      <div className="tab-bar" style={{ alignItems: "center" }}>
        {subTabs.map(s => (
          <button key={s.key} className={`tab-btn${subTab === s.key ? " active" : ""}`} onClick={() => { setSubTab(s.key); sessionStorage.setItem(`group-subtab-${groupName}`, s.key); }}>
            {s.label}
          </button>
        ))}
        {!useMock && (
          <button onClick={onTogglePin}
            title={isPinned ? "解除保護（允許刪除）" : "保護群組（防止刪除）"}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
              fontSize: "0.78rem", padding: "0 4px", opacity: isPinned ? 1 : 0.35,
              color: isPinned ? "var(--teal)" : "var(--dim)" }}>
            {isPinned ? "🔒" : "🔓"}
          </button>
        )}
      </div>

      {/* Stats bar */}
      <GroupStats quotes={quotes} />

      {/* Cards */}
      {subTab === "cards" && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 }}>
          {displayQuotes.map(q => (
            <div key={q.ticker} style={{ position: "relative" }}>
              <StockCard q={q} />
              {!useMock && (
                <button
                  className="ticker-chip-remove"
                  style={{ position: "absolute", top: 8, right: 8, fontSize: "1.1rem" }}
                  onClick={() => handleRemove(q.ticker)}
                  title={`移除 ${q.ticker}`}
                >×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      {(subTab === "pie" || subTab === "bar") && <GroupCharts quotes={quotes} view={subTab} />}

      {/* Premarket */}
      {subTab === "premarket" && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 }}>
          {tickers.map(t => <PremarketCard key={t} q={pmMap[t] ?? { ticker: t, price: null, pct: null, prev_close: null, time: null }} />)}
        </div>
      )}

      {/* Sort + Add controls */}
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select
          className="dash-input"
          style={{ width: "auto" }}
          value={sortMode}
          onChange={e => {
              const next = e.target.value as typeof sortMode;
              setSortMode(next);
              api.setSettings({ group_sorts: { [groupName]: next } }).catch(() => {});
            }}
        >
          <option value="custom">自訂順序</option>
          <option value="pct_desc">漲幅 ↓</option>
          <option value="pct_asc">漲幅 ↑</option>
          <option value="alpha">代號 A→Z</option>
          <option value="price_desc">價格 ↓</option>
        </select>

        <button className="dash-btn dash-btn-sm"
          disabled={useMock} title={useMock ? "exit demo to edit" : undefined}
          onClick={() => { if (!useMock) setShowSort(s => !s); }}>
          {showSort ? "↕ 收起排序 ▲" : "↕ 調整順序 ▼"}
        </button>

        <button className="dash-btn dash-btn-sm"
          disabled={useMock} title={useMock ? "exit demo to edit" : undefined}
          onClick={() => { if (!useMock) setShowAdd(s => !s); }}>
          {showAdd ? "✕ 取消" : "+ 新增股票"}
        </button>
      </div>

      {!useMock && showSort && sortMode === "custom" && (
        <div style={{ marginTop: 10 }}>
          <SortableChips items={tickers} onReorder={handleReorder} />
        </div>
      )}

      {!useMock && showAdd && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <input
            className="dash-input"
            style={{ width: 120 }}
            placeholder={market === "TW" ? "代號 (e.g. 2330)" : "代號 (e.g. NVDA)"}
            value={addInput}
            onChange={e => setAddInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
          />
          <button className="dash-btn" onClick={handleAdd} disabled={adding}>
            {adding ? <span className="spinner" /> : "新增"}
          </button>
          {addError && <span style={{ color: "var(--red)", fontSize: "0.75rem", alignSelf: "center" }}>{addError}</span>}
        </div>
      )}
    </div>
  );
}
