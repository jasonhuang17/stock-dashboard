"use client";
import type { Quote, PremarketQuote } from "@/lib/types";

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
            vs prev close ${q.prev_close?.toFixed(2) ?? "—"} · {timeStr}
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
