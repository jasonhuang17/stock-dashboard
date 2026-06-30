"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import type { Groups, MarketStatus, Market } from "@/lib/types";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { colorThemes, applyTheme } from "@/lib/themes";
import { GroupTab } from "./components/GroupTab";
import { PortfolioTab } from "./components/PortfolioTab";
import { MarketTab } from "./components/MarketTab";
import { CryptoTab } from "./components/CryptoTab";
import { ThemeSelector } from "./components/ThemeSelector";

const REFRESH_INTERVAL = 30;

function statusClass(s: MarketStatus) {
  if (s === "OPEN") return "s-open";
  if (s === "PRE/POST") return "s-pre";
  return "s-closed";
}

function SortableGroupTab({ id, isActive, isPinned, isRenaming, useMock, renameValue, market,
  onActivate, onDoubleClick, onDelete, onRenameChange, onRenameBlur, onRenameKeyDown,
}: {
  id: string; isActive: boolean; isPinned: boolean; isRenaming: boolean; useMock: boolean;
  renameValue: string; market: Market;
  onActivate: () => void; onDoubleClick: () => void; onDelete: () => void;
  onRenameChange: (v: string) => void; onRenameBlur: () => void;
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={{ ...style, position: "relative", display: "inline-flex", alignItems: "center" }} {...attributes}>
      {isRenaming ? (
        <input autoFocus value={renameValue}
          onChange={e => onRenameChange(e.target.value)}
          onKeyDown={onRenameKeyDown}
          onBlur={onRenameBlur}
          style={{ fontFamily: "Courier New", fontSize: "0.78rem", background: "#002040",
            border: "1px solid rgba(8,120,164,0.5)", borderRadius: 4, color: "var(--text)",
            padding: "3px 8px", width: 120, outline: "none" }}
        />
      ) : (
        <button className={`tab-btn${isActive ? " active" : ""}`}
          onClick={onActivate}
          onDoubleClick={onDoubleClick}
          {...listeners}
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        >
          {id}<span style={{ fontSize: "0.6rem", opacity: 0.55, marginLeft: 3 }}>{market === "TW" ? "🇹🇼" : "🇺🇸"}</span>
        </button>
      )}
      {!isPinned && !isRenaming && !useMock && (
        <span onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ fontSize: "0.65rem", color: "var(--dim)", cursor: "pointer", lineHeight: 1, padding: "2px 3px" }}
          title="Delete group"
        >×</span>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [tab, setTab]           = useState(0);
  const [groups, setGroups]     = useState<Groups>({});
  const [pinned, setPinned]     = useState<string[]>([]);
  const [markets, setMarkets]   = useState<Record<string, Market>>({});
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMarket, setNewGroupMarket] = useState<Market>("US");
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const groupSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [status, setStatus]     = useState<{ status: MarketStatus; time: string; us?: { status: MarketStatus; time: string }; tw?: { status: MarketStatus; time: string } } | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [useMock, setUseMock]       = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const cdRef         = useRef(REFRESH_INTERVAL);
  const tickRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const renameEscRef  = useRef(false);  // true when Escape was pressed, suppresses onBlur rename

  const loadMeta = useCallback(async () => {
    const [groupsResult, statusResult, settingsResult] = await Promise.allSettled([
      api.groups(),
      api.marketStatus(),
      api.getSettings(),
    ]);

    if (groupsResult.status === "fulfilled") {
      const gr = groupsResult.value;
      setGroups(gr.groups);
      setPinned(gr.pinned);
      setMarkets(gr.markets ?? {});
    }

    if (statusResult.status === "fulfilled") {
      setStatus(statusResult.value);
    }

    if (settingsResult.status === "fulfilled") {
      const settings = settingsResult.value;
      setUseMock(settings.use_mock);
      if (settings.theme) {
        const t = colorThemes.find(c => c.id === settings.theme);
        if (t) applyTheme(t);
      }
    }
    setSettingsLoaded(true);
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  useEffect(() => {
    cdRef.current = REFRESH_INTERVAL;
    tickRef.current = setInterval(() => {
      cdRef.current -= 1;
      setCountdown(cdRef.current);
      if (cdRef.current <= 0) {
        cdRef.current = REFRESH_INTERVAL;
        setRefreshKey(k => k + 1);
        api.marketStatus().then(s => setStatus(s)).catch(() => {});
      }
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function handleToggleMock() {
    const next = !useMock;
    setUseMock(next);
    await api.setSettings({ use_mock: next });
    // Trigger children to re-fetch immediately, then reload group tabs in parallel
    setRefreshKey(k => k + 1);
    const gr = await api.groups();
    setGroups(gr.groups);
    setPinned(gr.pinned);
    setMarkets(gr.markets ?? {});
  }

  async function handleCreateGroup() {
    const name = newGroupName.trim();
    const market = newGroupMarket; // capture before any state changes
    if (!name) return;
    try {
      const res = await api.createGroup(name, market);
      setGroups(res.groups);
      setPinned(res.pinned);
      // Merge instead of overwrite: if backend omits markets, at least set the new group correctly
      setMarkets(prev => ({ ...prev, ...(res.markets ?? { [name]: market }) }));
      const idx = Object.keys(res.groups).indexOf(name);
      if (idx >= 0) handleSetTab(idx + 1);
    } catch { /* silent */ }
    setNewGroupName("");
    setNewGroupMarket("US");
    setAddingGroup(false);
  }

  async function handleDeleteGroup(name: string) {
    const count = (groups[name] ?? []).length;
    const msg = count > 0
      ? `Delete "${name}" and its ${count} ticker(s)? This cannot be undone.`
      : `Delete "${name}"?`;
    if (!window.confirm(msg)) return;
    try {
      const res = await api.deleteGroup(name);
      setGroups(res.groups);
      setPinned(res.pinned);
      if (res.markets) setMarkets(res.markets);
      handleSetTab(0);
    } catch { /* silent */ }
  }

  async function handleToggleGroupPin(name: string) {
    try {
      const res = await api.toggleGroupPin(name);
      setGroups(res.groups);
      setPinned(res.pinned);
      if (res.markets) setMarkets(res.markets);
    } catch { /* silent */ }
  }

  async function handleRenameGroup() {
    if (!renamingGroup) return;
    const newName = renameValue.trim();
    if (!newName || newName === renamingGroup) { setRenamingGroup(null); return; }
    try {
      const res = await api.renameGroup(renamingGroup, newName);
      setGroups(res.groups);
      setPinned(res.pinned);
      if (res.markets) setMarkets(res.markets);
      // keep same tab index (name changed, position unchanged)
    } catch { /* silent */ }
    setRenamingGroup(null);
  }

  async function handleReorderGroups(newOrder: string[]) {
    const activeGroup = tab > 0 && tab <= groupNames.length ? groupNames[tab - 1] : null;
    setGroups(prev => Object.fromEntries(newOrder.filter(k => k in prev).map(k => [k, prev[k]])) as Groups);
    if (activeGroup) {
      const newIdx = newOrder.indexOf(activeGroup);
      if (newIdx !== -1) handleSetTab(newIdx + 1);
    }
    try {
      const res = await api.reorderGroups(newOrder);
      setGroups(res.groups);
      setPinned(res.pinned);
      if (res.markets) setMarkets(res.markets);
    } catch { /* silent */ }
  }

  function handleRefresh() {
    cdRef.current = REFRESH_INTERVAL;
    setCountdown(REFRESH_INTERVAL);
    setRefreshKey(k => k + 1);
    api.marketStatus().then(s => setStatus(s)).catch(() => {});
  }

  const groupNames = Object.keys(groups);
  const FIXED_TABS_END = ["📈 市場", "₿ 加密貨幣"];
  const marketTabIdx = groupNames.length + 1;
  const cryptoTabIdx = groupNames.length + 2;
  const tabs = ["💼 持倉", ...groupNames, ...FIXED_TABS_END];

  useEffect(() => {
    const saved = parseInt(sessionStorage.getItem("dashboard-tab") ?? "0", 10) || 0;
    if (saved > 0) setTab(saved);
  }, []);

  function handleSetTab(i: number) {
    setTab(i);
    sessionStorage.setItem("dashboard-tab", String(i));
  }
  useEffect(() => {
    if (groupNames.length > 0 && tab >= tabs.length) handleSetTab(0);
  }, [groupNames.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: "0.5rem 2rem 2rem", maxWidth: "100%", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50, margin: "0 -2rem", padding: "14px 2rem 10px", transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s", background: scrolled ? "#002040" : "#001d3a", borderBottom: scrolled ? "1px solid rgba(8,120,164,0.35)" : "1px solid transparent", boxShadow: scrolled ? "0 4px 16px rgba(0,0,0,0.35)" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="dash-title">◈ STOCK DASHBOARD</span>
          {status?.us && (
            <>
              <span className={`status-pill ${statusClass(status.us.status)}`}>{status.us.status}</span>
              <span style={{ color: "var(--teal)", fontSize: "0.78rem", fontFamily: "Courier New" }}>ET {status.us.time}</span>
            </>
          )}
          <span style={{ width: 1, height: 14, background: "rgba(8,120,164,0.35)", flexShrink: 0 }} />
          {status?.tw && (
            <>
              <span className={`status-pill ${statusClass(status.tw.status)}`}>{status.tw.status}</span>
              <span style={{ color: "var(--teal)", fontSize: "0.78rem", fontFamily: "Courier New" }}>台北 {status.tw.time}</span>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ThemeSelector />
          <button onClick={handleToggleMock} style={{ fontFamily: "Courier New", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 20, border: `1px solid ${useMock ? "rgba(237,209,112,0.6)" : "rgba(8,120,164,0.4)"}`, background: useMock ? "rgba(237,209,112,0.12)" : "transparent", color: useMock ? "var(--gold)" : "var(--dim)", cursor: "pointer" }}>
            {useMock ? "◈ DEMO" : "DEMO"}
          </button>
          <button className="dash-btn" onClick={handleRefresh}>↻ REFRESH</button>
        </div>
      </div>

      {/* Demo mode banner — sticky, taller, consistent with header */}
      {useMock && (
        <div style={{ position: "sticky", top: 53, zIndex: 49, margin: "0 -2rem", padding: "10px 2rem", background: "rgba(30,15,0,0.95)", borderBottom: "1px solid rgba(237,209,112,0.45)", display: "flex", alignItems: "center", gap: 12, fontSize: "0.76rem", fontFamily: "Courier New", letterSpacing: "0.06em", backdropFilter: "blur(8px)" }}>
          <span style={{ color: "var(--gold)", fontWeight: 700, fontSize: "0.82rem" }}>⚡ DEMO MODE</span>
          <span style={{ color: "rgba(237,209,112,0.60)" }}>— showing sample data, not your real portfolio</span>
          <button onClick={handleToggleMock} style={{ marginLeft: "auto", color: "rgba(237,209,112,0.7)", background: "none", border: "1px solid rgba(237,209,112,0.35)", borderRadius: 4, cursor: "pointer", fontSize: "0.72rem", fontFamily: "Courier New", padding: "2px 8px" }}>exit demo ×</button>
        </div>
      )}

      {/* Countdown */}
      <div style={{ fontSize: "0.7rem", color: "var(--teal)", letterSpacing: "0.06em", marginBottom: 2 }}>
        ↻&nbsp; next data update in {countdown}s · prices up to ~30s delayed (Yahoo Finance)
      </div>
      <hr className="dash-hr" style={{ marginBottom: 12 }} />

      {/* Main tabs */}
      <div className="tab-bar main-tab-bar">
        {/* 持倉 tab */}
        <button className={`tab-btn main-tab-fixed${tab === 0 ? " active" : ""}`} onClick={() => handleSetTab(0)}>
          💼 持倉
        </button>

        <div className="main-tab-scroll">
          {/* Divider between 持倉 and watchlist groups */}
          {groupNames.length > 0 && <span className="main-tab-divider" />}

          {/* Group tabs — dnd-kit sortable */}
          <DndContext sensors={groupSensors} collisionDetection={closestCenter} onDragEnd={(event: DragEndEvent) => {
            const { active, over } = event;
            if (!useMock && over && active.id !== over.id) {
              const oldIdx = groupNames.indexOf(active.id as string);
              const newIdx = groupNames.indexOf(over.id as string);
              handleReorderGroups(arrayMove(groupNames, oldIdx, newIdx));
            }
          }}>
            <SortableContext items={groupNames} strategy={horizontalListSortingStrategy}>
              <div className="main-group-tabs">
                {groupNames.map((g, i) => {
                  const tabIdx = i + 1;
                  return (
                    <SortableGroupTab key={g} id={g}
                      isActive={tab === tabIdx}
                      isPinned={pinned.includes(g)}
                      isRenaming={renamingGroup === g}
                      useMock={useMock}
                      renameValue={renameValue}
                      market={markets[g] ?? "US"}
                      onActivate={() => handleSetTab(tabIdx)}
                      onDoubleClick={() => { if (!useMock) { setRenamingGroup(g); setRenameValue(g); } }}
                      onDelete={() => handleDeleteGroup(g)}
                      onRenameChange={v => setRenameValue(v)}
                      onRenameBlur={() => { if (renameEscRef.current) { renameEscRef.current = false; return; } handleRenameGroup(); }}
                      onRenameKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { renameEscRef.current = true; setRenamingGroup(null); } }}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

          {/* Add group */}
          {!addingGroup ? (
            <button className="tab-btn" onClick={() => { if (!useMock) setAddingGroup(true); }}
              disabled={useMock}
              title={useMock ? "exit demo to edit" : undefined}
              style={{ padding: "4px 10px", fontSize: "0.88rem", color: useMock ? "var(--dim)" : "var(--teal)", lineHeight: 1, cursor: useMock ? "not-allowed" : "pointer" }}>+</button>
          ) : (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input
                autoFocus
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreateGroup(); if (e.key === "Escape") { setAddingGroup(false); setNewGroupName(""); setNewGroupMarket("US"); } }}
                placeholder="group name"
                style={{ fontFamily: "Courier New", fontSize: "0.78rem", background: "#002040", border: "1px solid rgba(8,120,164,0.5)", borderRadius: 4, color: "var(--text)", padding: "3px 8px", width: 110, outline: "none" }}
              />
              <select
                value={newGroupMarket}
                onChange={e => setNewGroupMarket(e.target.value as Market)}
                style={{ fontFamily: "Courier New", fontSize: "0.72rem", background: "#002040", border: "1px solid rgba(8,120,164,0.5)", borderRadius: 4, color: "var(--text)", padding: "3px 6px", outline: "none", cursor: "pointer" }}
              >
                <option value="US">🇺🇸 US</option>
                <option value="TW">🇹🇼 TW</option>
              </select>
              <button className="dash-btn dash-btn-sm" onClick={handleCreateGroup}>add</button>
              <button className="dash-btn dash-btn-sm" onClick={() => { setAddingGroup(false); setNewGroupName(""); setNewGroupMarket("US"); }}>cancel</button>
            </div>
          )}

          {/* Divider before fixed tabs */}
          {groupNames.length > 0 && <span className="main-tab-divider" />}

          {/* Fixed tabs: 市場 + 加密貨幣 */}
          <button className={`tab-btn${tab === marketTabIdx ? " active" : ""}`} onClick={() => handleSetTab(marketTabIdx)}>
            📈 市場 <span style={{ fontSize: "0.6em", opacity: 0.6, fontWeight: 400, letterSpacing: 0 }}>Beta</span>
          </button>
          <button className={`tab-btn${tab === cryptoTabIdx ? " active" : ""}`} onClick={() => handleSetTab(cryptoTabIdx)}>
            ₿ 加密貨幣
          </button>
        </div>
      </div>

      {/* Tab content — gated on settingsLoaded to prevent useMock=false flash on page refresh */}
      {settingsLoaded && tab === 0 && <PortfolioTab refreshKey={refreshKey} useMock={useMock} />}
      {settingsLoaded && groupNames.map((g, i) => (
        tab === i + 1 && (
          <GroupTab
            key={g}
            groupName={g}
            tickers={groups[g] ?? []}
            market={markets[g] ?? "US"}
            refreshKey={refreshKey}
            useMock={useMock}
            isPinned={pinned.includes(g)}
            onTickersChange={tickers => setGroups(prev => ({ ...prev, [g]: tickers }))}
            onTogglePin={() => handleToggleGroupPin(g)}
          />
        )
      ))}
      {settingsLoaded && tab === marketTabIdx && <MarketTab refreshKey={refreshKey} />}
      {settingsLoaded && tab === cryptoTabIdx && <CryptoTab refreshKey={refreshKey} />}

      {/* Footer */}
      <div style={{ fontFamily: "Courier New", fontSize: "0.68rem", color: "var(--dim)", textAlign: "center", padding: "18px 0 6px", borderTop: "1px solid rgba(8,120,164,0.15)", marginTop: 24 }}>
        ◈ &nbsp;Stock Dashboard &nbsp;·&nbsp; Made by Jason Huang &nbsp;·&nbsp; Data via Yahoo Finance &nbsp;·&nbsp; 2026
      </div>
    </div>
  );
}
