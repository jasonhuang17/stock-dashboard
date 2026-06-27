"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import type { Groups, MarketStatus } from "@/lib/types";
import { GroupTab } from "./components/GroupTab";
import { PortfolioTab } from "./components/PortfolioTab";

const REFRESH_INTERVAL = 30;

function statusClass(s: MarketStatus) {
  if (s === "OPEN") return "s-open";
  if (s === "PRE/POST") return "s-pre";
  return "s-closed";
}

export default function Dashboard() {
  const [tab, setTab]           = useState(0);
  const [groups, setGroups]     = useState<Groups>({});
  const [pinned, setPinned]     = useState<string[]>([]);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [status, setStatus]     = useState<{ status: MarketStatus; time: string } | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [useMock, setUseMock]   = useState(false);
  const cdRef   = useRef(REFRESH_INTERVAL);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const [gr, s, settings] = await Promise.all([api.groups(), api.marketStatus(), api.getSettings()]);
      setGroups(gr.groups);
      setPinned(gr.pinned);
      setStatus(s);
      setUseMock(settings.use_mock);
    } catch { /* silent */ }
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
  }

  async function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      const res = await api.createGroup(name);
      setGroups(res.groups);
      setPinned(res.pinned);
      const idx = Object.keys(res.groups).indexOf(name);
      if (idx >= 0) handleSetTab(idx + 1);
    } catch { /* silent */ }
    setNewGroupName("");
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
      handleSetTab(0);
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
      // keep same tab index (name changed, position unchanged)
    } catch { /* silent */ }
    setRenamingGroup(null);
  }

  function handleRefresh() {
    cdRef.current = REFRESH_INTERVAL;
    setCountdown(REFRESH_INTERVAL);
    setRefreshKey(k => k + 1);
    api.marketStatus().then(s => setStatus(s)).catch(() => {});
  }

  const groupNames = Object.keys(groups);
  const tabs = ["💼 持倉", ...groupNames];

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
      <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50, margin: "0 -2rem", padding: "8px 2rem 4px", transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s", background: scrolled ? "#002040" : "#001d3a", borderBottom: scrolled ? "1px solid rgba(8,120,164,0.35)" : "1px solid transparent", boxShadow: scrolled ? "0 4px 16px rgba(0,0,0,0.35)" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="dash-title">◈ STOCK DASHBOARD</span>
          {status && <span className={`status-pill ${statusClass(status.status)}`}>{status.status}</span>}
          {status && <span style={{ color: "#475569", fontSize: "0.78rem" }}>ET {status.time}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={handleToggleMock} style={{ fontFamily: "Courier New", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 20, border: `1px solid ${useMock ? "rgba(237,209,112,0.6)" : "rgba(8,120,164,0.4)"}`, background: useMock ? "rgba(237,209,112,0.12)" : "transparent", color: useMock ? "var(--gold)" : "var(--dim)", cursor: "pointer" }}>
            {useMock ? "◈ DEMO" : "DEMO"}
          </button>
          <button className="dash-btn" onClick={handleRefresh}>↻ REFRESH</button>
        </div>
      </div>

      {/* Countdown */}
      <div style={{ fontSize: "0.7rem", color: "var(--teal)", letterSpacing: "0.06em", marginBottom: 2 }}>
        ↻&nbsp; next data update in {countdown}s · prices ~15s delayed (Yahoo Finance)
      </div>
      <hr className="dash-hr" style={{ marginBottom: 12 }} />

      {/* Main tabs */}
      <div className="tab-bar" style={{ alignItems: "center" }}>
        {/* 持倉 tab */}
        <button className={`tab-btn${tab === 0 ? " active" : ""}`} onClick={() => handleSetTab(0)}>
          💼 持倉
        </button>

        {/* Divider between 持倉 and watchlist groups */}
        {groupNames.length > 0 && (
          <span style={{ width: 1, height: 18, background: "rgba(8,120,164,0.35)", margin: "0 4px", flexShrink: 0 }} />
        )}

        {/* Group tabs */}
        {groupNames.map((g, i) => {
          const tabIdx = i + 1;
          const isActive = tab === tabIdx;
          const isPinned = pinned.includes(g);
          const isRenaming = renamingGroup === g;
          return (
            <div key={g} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              {isRenaming ? (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleRenameGroup(); if (e.key === "Escape") setRenamingGroup(null); }}
                    onBlur={handleRenameGroup}
                    style={{ fontFamily: "Courier New", fontSize: "0.78rem", background: "#002040", border: "1px solid rgba(8,120,164,0.5)", borderRadius: 4, color: "var(--text)", padding: "3px 8px", width: 120, outline: "none" }}
                  />
                </div>
              ) : (
                <button
                  className={`tab-btn${isActive ? " active" : ""}`}
                  onClick={() => handleSetTab(tabIdx)}
                  onDoubleClick={() => { setRenamingGroup(g); setRenameValue(g); }}
                  style={!isPinned ? { paddingRight: "1.5rem" } : undefined}
                  title="Double-click to rename"
                >
                  {g}
                </button>
              )}
              {!isPinned && !isRenaming && (
                <span
                  onClick={e => { e.stopPropagation(); handleDeleteGroup(g); }}
                  style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", fontSize: "0.65rem", color: "var(--dim)", cursor: "pointer", lineHeight: 1, padding: "2px 3px" }}
                  title="Delete group"
                >×</span>
              )}
            </div>
          );
        })}

        {/* Add group */}
        {!addingGroup ? (
          <button className="tab-btn" onClick={() => setAddingGroup(true)}
            style={{ padding: "4px 10px", fontSize: "0.88rem", color: "var(--teal)", lineHeight: 1 }}>+</button>
        ) : (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input
              autoFocus
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreateGroup(); if (e.key === "Escape") { setAddingGroup(false); setNewGroupName(""); } }}
              placeholder="group name"
              style={{ fontFamily: "Courier New", fontSize: "0.78rem", background: "#002040", border: "1px solid rgba(8,120,164,0.5)", borderRadius: 4, color: "var(--text)", padding: "3px 8px", width: 120, outline: "none" }}
            />
            <button className="dash-btn dash-btn-sm" onClick={handleCreateGroup}>add</button>
            <button className="dash-btn dash-btn-sm" onClick={() => { setAddingGroup(false); setNewGroupName(""); }}>cancel</button>
          </div>
        )}
      </div>

      {/* Tab content */}
      {tab === 0 && <PortfolioTab refreshKey={refreshKey} />}
      {groupNames.map((g, i) => (
        tab === i + 1 && (
          <GroupTab
            key={g}
            groupName={g}
            tickers={groups[g] ?? []}
            refreshKey={refreshKey}
            onTickersChange={tickers => setGroups(prev => ({ ...prev, [g]: tickers }))}
          />
        )
      ))}

      {/* Footer */}
      <div style={{ fontFamily: "Courier New", fontSize: "0.68rem", color: "var(--dim)", textAlign: "center", padding: "18px 0 6px", borderTop: "1px solid rgba(8,120,164,0.15)", marginTop: 24 }}>
        ◈ &nbsp;Stock Dashboard &nbsp;·&nbsp; Made by Jason Huang &nbsp;·&nbsp; Data via Yahoo Finance &nbsp;·&nbsp; 2026
      </div>
    </div>
  );
}
