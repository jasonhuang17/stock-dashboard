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
  const [tab, setTab] = useState(0);           // 0 = 持倉, 1+ = groups
  const [groups, setGroups] = useState<Groups>({});
  const [status, setStatus] = useState<{ status: MarketStatus; time: string } | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [refreshKey, setRefreshKey] = useState(0);  // bump to force child re-fetch
  const cdRef = useRef(REFRESH_INTERVAL);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const [g, s] = await Promise.all([api.groups(), api.marketStatus()]);
      setGroups(g);
      setStatus(s);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  // Countdown + auto-refresh
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

  function handleRefresh() {
    cdRef.current = REFRESH_INTERVAL;
    setCountdown(REFRESH_INTERVAL);
    setRefreshKey(k => k + 1);
    api.marketStatus().then(s => setStatus(s)).catch(() => {});
  }

  const groupNames = Object.keys(groups);
  const tabs = ["💼 持倉", ...groupNames];

  return (
    <div style={{ padding: "0.5rem 2rem 2rem", maxWidth: "100%", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 0 4px", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="dash-title">◈ STOCK DASHBOARD</span>
          {status && (
            <span className={`status-pill ${statusClass(status.status)}`}>{status.status}</span>
          )}
          {status && (
            <span style={{ color: "#475569", fontSize: "0.78rem" }}>ET {status.time}</span>
          )}
        </div>
        <button className="dash-btn" onClick={handleRefresh}>↻ REFRESH</button>
      </div>

      {/* Countdown */}
      <div style={{ fontSize: "0.7rem", color: "var(--teal)", letterSpacing: "0.06em", marginBottom: 2 }}>
        ↻&nbsp; next data update in {countdown}s · prices ~15s delayed (Yahoo Finance)
      </div>
      <hr className="dash-hr" style={{ marginBottom: 12 }} />

      {/* Main tabs */}
      <div className="tab-bar">
        {tabs.map((t, i) => (
          <button key={t} className={`tab-btn${tab === i ? " active" : ""}`} onClick={() => setTab(i)}>
            {t}
          </button>
        ))}
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
