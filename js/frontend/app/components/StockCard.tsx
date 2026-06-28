"use client";
import { useState } from "react";
import type { Quote, PremarketQuote } from "@/lib/types";

function FixedTip({ text, children }: { text: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  return (
    <span
      onMouseEnter={e => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.top });
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      <span style={{
        position: "fixed", left: pos.x, top: pos.y - 8,
        transform: "translate(-50%, -100%)",
        opacity: hovered ? 1 : 0, transition: "opacity 0.12s",
        pointerEvents: "none", background: "#001828",
        border: "1px solid rgba(30,207,214,0.3)", color: "var(--text)",
        fontSize: "0.68rem", fontWeight: 400, letterSpacing: 0,
        padding: "5px 10px", borderRadius: 5, whiteSpace: "nowrap",
        zIndex: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}>
        {text}
      </span>
    </span>
  );
}

function colorClass(pct: number | null) {
  if (pct === null) return "neu";
  return pct >= 0 ? "pos" : "neg";
}

function arrow(pct: number | null) {
  if (pct === null) return "";
  return pct >= 0 ? "▲" : "▼";
}

export function StockCard({ q }: { q: Quote }) {
  const cls = colorClass(q.pct);
  return (
    <div className="stock-card">
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: "1rem", fontWeight: 800, color: "var(--teal)", letterSpacing: "0.18em" }}>
          {q.ticker}
        </div>
        {q.name && (
          <div style={{ fontSize: "0.65rem", color: "var(--dim)", marginTop: 2 }}>{q.name}</div>
        )}
      </div>
      {q.price !== null ? (
        <>
          <div style={{ fontSize: "1.1rem", color: "var(--text)", fontWeight: 600, marginBottom: 5 }}>
            ${q.price.toFixed(2)}
          </div>
          <div className={`${cls}`} style={{ fontSize: "0.9rem", fontWeight: 700 }}>
            {arrow(q.pct)} {q.pct !== null ? `${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%` : "—"}
          </div>
        </>
      ) : (
        <>
          <div className="neu" style={{ fontSize: "1.1rem", marginBottom: 5 }}>—</div>
          <div className="neu" style={{ fontSize: "0.9rem" }}>N / A</div>
        </>
      )}
    </div>
  );
}

export function PremarketCard({ q }: { q: PremarketQuote }) {
  const cls = colorClass(q.pct);
  const timeStr = q.time ? new Date(q.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) : "—";
  return (
    <div className="stock-card">
      <div style={{ fontSize: "1rem", fontWeight: 800, color: "var(--teal)", letterSpacing: "0.18em", marginBottom: 6 }}>
        {q.ticker}
      </div>
      {q.price !== null ? (
        <>
          <div style={{ fontSize: "1.1rem", color: "var(--text)", fontWeight: 600, marginBottom: 5 }}>
            ${q.price.toFixed(2)}
          </div>
          <div className={cls} style={{ fontSize: "0.9rem", fontWeight: 700 }}>
            {arrow(q.pct)} {q.pct !== null ? `${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%` : "—"}
          </div>
          <div style={{ fontSize: "0.68rem", color: "var(--dim)", marginTop: 4 }}>
            <FixedTip text="相對於上個交易日收盤價的變動">
              <span style={{ borderBottom: "1px dotted rgba(100,130,160,0.5)", cursor: "default" }}>vs prev close</span>
            </FixedTip>
            {" "}${q.prev_close?.toFixed(2) ?? "—"} · {timeStr}
          </div>
        </>
      ) : (
        <>
          <div className="neu" style={{ fontSize: "1.1rem", marginBottom: 5 }}>—</div>
          <div className="neu" style={{ fontSize: "0.9rem" }}>N / A</div>
        </>
      )}
    </div>
  );
}
