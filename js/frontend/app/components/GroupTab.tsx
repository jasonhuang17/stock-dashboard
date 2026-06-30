"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Quote, PremarketQuote, Market } from "@/lib/types";
import { StockCard, PremarketCard } from "./StockCard";
import { GroupStats, GroupCharts } from "./GroupCharts";
import { SortableChips } from "./SortableChips";

type SubTab = "cards" | "pie" | "bar" | "premarket";

function LockTip({ text, children }: { text: string; children: React.ReactNode }) {
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
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [suggestions, setSuggestions] = useState<{ code: string; name: string }[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [hoveredSugg, setHoveredSugg] = useState(-1);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function searchTw(q: string) {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (!q.trim()) { setSuggestions([]); return; }
    suggestTimer.current = setTimeout(async () => {
      try { setSuggestions(await api.twSearch(q.trim())); }
      catch { setSuggestions([]); }
    }, 200);
  }

  function searchUs(q: string) {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (!q.trim()) { setSuggestions([]); return; }
    suggestTimer.current = setTimeout(async () => {
      try { setSuggestions(await api.usSearch(q.trim())); }
      catch { setSuggestions([]); }
    }, 300);
  }

  async function handleAdd() {
    const t = addInput.trim().toUpperCase();
    if (!t) { setAddError("請輸入代號"); return; }
    setAdding(true);
    setAddError("");
    setSuggestions([]);
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
      setAddInput(""); setSelectedName("");
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
          <LockTip text={isPinned ? "已鎖定：無法刪除此群組（點擊解鎖）" : "未鎖定：點擊鎖定以防止刪除"}>
            <button onClick={onTogglePin}
              style={{ background: "none", border: "none", cursor: "pointer",
                fontSize: "0.78rem", padding: "0 4px", opacity: isPinned ? 1 : 0.35,
                color: isPinned ? "var(--teal)" : "var(--dim)" }}>
              {isPinned ? "🔒" : "🔓"}
            </button>
          </LockTip>
        )}
      </div>

      {/* Add stock row — always visible right below tabs */}
      {!useMock && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <input
              className="dash-input"
              style={{ width: 140 }}
              placeholder={market === "TW" ? "代號或中文名稱" : "代號或公司名稱"}
              value={addInput}
              onChange={e => {
                const v = e.target.value;
                setAddInput(v); setSelectedName("");
                if (market === "TW") searchTw(v); else searchUs(v);
                setAddError("");
              }}
              onKeyDown={e => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") setSuggestions([]);
              }}
              onBlur={() => setTimeout(() => { setSuggestions([]); setHoveredSugg(-1); }, 150)}
            />
            {selectedName && (
              <div style={{ fontSize: "0.7rem", color: "var(--teal)", marginTop: 3, whiteSpace: "nowrap", letterSpacing: "0.02em" }}>
                {selectedName}
              </div>
            )}
            {suggestions.length > 0 && (
              <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, zIndex: 200, background: "#001828", border: "1px solid rgba(30,207,214,0.35)", borderRadius: 4, minWidth: 210, maxHeight: 220, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,0.55)" }}>
                {suggestions.map((s, i) => (
                  <div key={s.code}
                    onMouseDown={() => { setAddInput(s.code); setSelectedName(s.name); setSuggestions([]); setHoveredSugg(-1); }}
                    onMouseEnter={() => setHoveredSugg(i)}
                    onMouseLeave={() => setHoveredSugg(-1)}
                    style={{ padding: "5px 10px", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", fontSize: "0.78rem", background: hoveredSugg === i ? "rgba(30,207,214,0.1)" : "transparent", borderBottom: i < suggestions.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                    <span style={{ fontFamily: "Courier New", color: "var(--teal)", minWidth: 58, flexShrink: 0 }}>{s.code}</span>
                    <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="dash-btn" onClick={handleAdd} disabled={adding}>
            {adding ? <span className="spinner" /> : "新增"}
          </button>
          {addError && <span style={{ color: "var(--red)", fontSize: "0.75rem", alignSelf: "center" }}>{addError}</span>}
        </div>
      )}

      {/* Stats bar */}
      <GroupStats quotes={quotes} />

      {/* Cards */}
      {subTab === "cards" && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 }}>
          {displayQuotes.map(q => (
            <div key={q.ticker} style={{ position: "relative" }}>
              <Link href={`/stock/${encodeURIComponent(q.ticker)}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                <StockCard q={q} />
              </Link>
              {!useMock && (
                <button
                  className="ticker-chip-remove"
                  style={{ position: "absolute", top: 8, right: 8, fontSize: "1.1rem" }}
                  onClick={e => { e.stopPropagation(); e.preventDefault(); handleRemove(q.ticker); }}
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
          {tickers.map(t => (
            <Link key={t} href={`/stock/${encodeURIComponent(t)}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <PremarketCard q={pmMap[t] ?? { ticker: t, price: null, pct: null, prev_close: null, time: null }} />
            </Link>
          ))}
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

      </div>

      {!useMock && showSort && sortMode === "custom" && (
        <div style={{ marginTop: 10 }}>
          <SortableChips items={tickers} onReorder={handleReorder} />
        </div>
      )}

    </div>
  );
}
