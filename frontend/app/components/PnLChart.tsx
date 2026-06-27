"use client";
import React, { useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, Cell,
  BarChart, Bar, LabelList, ReferenceLine,
  Treemap,
} from "recharts";
import type { PortfolioRow } from "@/lib/types";

type Currency = "USD" | "TWD";
type View = "bubble" | "waterfall" | "treemap" | "bar";

const PALETTE = ["#1ECFD6","#EDD170","#C05640","#5BB8D4","#F0A835","#E8855A","#3A9BC1","#7EDDE4","#0D5C8C","#F5C842","#1AA5B0"];
const POS = "#C05640";
const NEG = "#3DAA70";

function color(v: number | null) { return v === null ? "#6899b8" : v >= 0 ? POS : NEG; }

function BubbleChart({ rows }: { rows: PortfolioRow[] }) {
  const data = rows.filter(r => r.price !== null).map(r => ({
    ticker: r.ticker,
    x: r.pct ?? 0,
    y: r.today_gain ?? 0,
    z: Math.abs((r.price ?? 0) * r.shares),
  }));

  // Pad domains so edge bubbles don't overflow the plot area.
  // Y needs ~30%: the largest bubble radius is ~23% of plot height.
  const xs = data.map(d => d.x);
  const ys = data.map(d => d.y);
  const xMin = Math.min(...xs, 0), xMax = Math.max(...xs, 0);
  const yMin = Math.min(...ys, 0), yMax = Math.max(...ys, 0);
  const xPad = Math.max((xMax - xMin) * 0.22, 1);
  const yPad = Math.max((yMax - yMin) * 0.30, 1);
  const xDomain: [number, number] = [xMin - xPad, xMax + xPad];
  const yDomainPadded: [number, number] = [yMin - yPad, yMax + yPad];

  // Power-of-10 ticks targeting ~5 intervals, minimum base 10 (integers only).
  // Using round(log10(range/5)) picks the right magnitude; floor() gives too many ticks,
  // ceil() too few — round() hits ~4-6 every time.
  const yRange = Math.max(yDomainPadded[1] - yDomainPadded[0], 20);
  const yBase = Math.pow(10, Math.max(1, Math.round(Math.log10(yRange / 5))));
  const yTickMin = Math.floor(yDomainPadded[0] / yBase) * yBase;
  const yTickMax = Math.ceil(yDomainPadded[1] / yBase) * yBase;
  const yTicks: number[] = [];
  for (let t = yTickMin; t <= yTickMax + 0.01; t += yBase) yTicks.push(Math.round(t));
  // Expand domain to cover all ticks so none are clipped
  const yDomain: [number, number] = [
    Math.min(yDomainPadded[0], yTickMin),
    Math.max(yDomainPadded[1], yTickMax),
  ];

  type DotEntry = typeof data[0];

  const renderDot = (props: Record<string, unknown>) => {
    const { cx, cy, payload, size } = props as { cx: number; cy: number; payload: DotEntry; size: number };
    const r = Math.sqrt(size / Math.PI);
    const fillColor = color(payload.y);
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={fillColor} fillOpacity={0.82} />
        <text x={cx} y={cy - r - 5} textAnchor="middle"
          fill="#d4eaf5" fontSize={11} fontFamily="Courier New" fontWeight={700}>
          {payload.ticker}
        </text>
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ScatterChart margin={{ top: 48, right: 60, bottom: 24, left: 16 }}>
        <XAxis dataKey="x" type="number" name="今日%" domain={xDomain} tick={{ fill: "#6899b8", fontSize: 11 }} tickFormatter={v => `${v.toFixed(1)}%`} />
        <YAxis dataKey="y" type="number" name="今日損益" domain={yDomain} ticks={yTicks} tickFormatter={v => v.toLocaleString()} tick={{ fill: "#6899b8", fontSize: 11 }} />
        <Tooltip
          cursor={{ stroke: "rgba(30,207,214,0.2)" }}
          content={({ payload: pl }) => {
            const d = pl?.[0]?.payload as DotEntry | undefined;
            if (!d) return null;
            return (
              <div style={{ background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)", padding: "8px 12px", fontFamily: "Courier New", fontSize: 12 }}>
                <div style={{ color: "#1ECFD6", fontWeight: 700, marginBottom: 4 }}>{d.ticker}</div>
                <div>今日%：{d.x >= 0 ? "+" : ""}{d.x.toFixed(2)}%</div>
                <div style={{ color: d.y >= 0 ? "#c05640" : "#3daa70" }}>
                  今日損益：{d.y >= 0 ? "+" : ""}{d.y.toFixed(2)}
                </div>
              </div>
            );
          }}
        />
        <ZAxis dataKey="z" range={[1600, 12000]} />
        <ReferenceLine x={0} stroke="rgba(8,120,164,0.3)" />
        <ReferenceLine y={0} stroke="rgba(8,120,164,0.3)" />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Scatter data={data} shape={renderDot as any} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function WaterfallChart({ rows, currency }: { rows: PortfolioRow[]; currency: Currency }) {
  const valid = rows.filter(r => r.today_gain !== null);
  const sorted = [...valid].sort((a, b) => (b.today_gain ?? 0) - (a.today_gain ?? 0));
  const total = sorted.reduce((s, r) => s + (r.today_gain ?? 0), 0);
  const sym = currency === "TWD" ? "NT$" : "$";

  const data = [
    ...sorted.map(r => ({ name: r.ticker, value: r.today_gain ?? 0 })),
    { name: "合計", value: total },
  ];

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
        <XAxis dataKey="name" tick={{ fill: "#6899b8", fontSize: 11 }} />
        <YAxis tick={{ fill: "#6899b8", fontSize: 11 }} tickFormatter={v => `${sym}${v.toFixed(0)}`} />
        <Tooltip
          contentStyle={{ background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)", fontFamily: "Courier New", fontSize: 12 }}
          formatter={(v: unknown) => { const n = v as number; return [`${sym}${n.toFixed(2)}`, "損益"] as [string, string]; }}
        />
        <ReferenceLine y={0} stroke="rgba(8,120,164,0.3)" />
        <Bar dataKey="value">
          {data.map((d, i) => <Cell key={i} fill={color(d.value)} fillOpacity={i === data.length - 1 ? 1 : 0.75} />)}
          <LabelList dataKey="value" position="top" style={{ fill: "#6899b8", fontSize: 10 }} formatter={(v: unknown) => {
            const n = v as number;
            return `${n >= 0 ? "+" : "-"}${sym}${Math.abs(n).toFixed(0)}`;
          }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TreemapChart({ rows }: { rows: PortfolioRow[] }) {
  const data = rows
    .filter(r => r.price !== null)
    .map(r => ({ name: r.ticker, size: Math.abs((r.price ?? 0) * r.shares), pct: r.pct ?? 0 }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <Treemap data={data} dataKey="size" nameKey="name" aspectRatio={4 / 3}
        content={(props: Record<string, unknown>) => {
          const { x, y, width, height, name, pct } = props as {
            x: number; y: number; width: number; height: number;
            name?: string; pct?: number;
          };
          // Recharts passes a root wrapper node with no leaf data — skip it
          if (typeof pct !== "number" || !name) return <g />;
          return (
            <g>
              <rect x={x} y={y} width={width} height={height} fill={color(pct)} fillOpacity={0.75} stroke="rgba(0,29,58,0.8)" strokeWidth={2} />
              {width > 48 && height > 28 && (
                <>
                  <text x={x + width / 2} y={y + height / 2 - 6} textAnchor="middle" fill="#d4eaf5" fontSize={13} fontFamily="Courier New" fontWeight={700}>{name}</text>
                  <text x={x + width / 2} y={y + height / 2 + 10} textAnchor="middle" fill="#d4eaf5" fontSize={12} fontFamily="Courier New">{`${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}</text>
                </>
              )}
            </g>
          );
        }}
      />
    </ResponsiveContainer>
  );
}

function BarChartView({ rows, currency }: { rows: PortfolioRow[]; currency: Currency }) {
  const valid = rows.filter(r => r.today_gain !== null);
  const sorted = [...valid].sort((a, b) => (a.today_gain ?? 0) - (b.today_gain ?? 0));
  const sym = currency === "TWD" ? "NT$" : "$";

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, sorted.length * 36)}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 60, left: 10, bottom: 4 }}>
        <XAxis type="number" tick={{ fill: "#6899b8", fontSize: 11 }} tickFormatter={v => `${sym}${v.toFixed(0)}`} />
        <YAxis type="category" dataKey="ticker" tick={{ fill: "#1ECFD6", fontSize: 11, fontFamily: "Courier New", fontWeight: 700 }} width={55} />
        <Tooltip
          contentStyle={{ background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)", fontFamily: "Courier New", fontSize: 12 }}
          formatter={(v: unknown) => { const n = v as number; return [`${sym}${n.toFixed(2)}`, "今日損益"] as [string, string]; }}
        />
        <ReferenceLine x={0} stroke="rgba(8,120,164,0.3)" />
        <Bar dataKey="today_gain" radius={[0, 3, 3, 0]}>
          {sorted.map((r, i) => <Cell key={i} fill={color(r.today_gain)} fillOpacity={0.8} />)}
          <LabelList dataKey="today_gain" position="right" style={{ fill: "#6899b8", fontSize: 10 }} formatter={(v: unknown) => { const n = v as number; return n >= 0 ? `+${n.toFixed(0)}` : n.toFixed(0); }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PnLChart({ rows, currency }: { rows: PortfolioRow[]; currency: Currency }) {
  const [view, setView] = useState<View>("bubble");
  if (!rows.some(r => r.price !== null)) return null;

  const views: { key: View; label: string }[] = [
    { key: "bubble",    label: "氣泡圖" },
    { key: "waterfall", label: "瀑布圖" },
    { key: "treemap",   label: "樹狀圖" },
    { key: "bar",       label: "長條圖" },
  ];

  return (
    <div style={{ marginTop: 16 }}>
      <div className="chart-switcher">
        {views.map(v => (
          <button key={v.key} className={`chart-btn${view === v.key ? " active" : ""}`} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      {view === "bubble"    && <BubbleChart rows={rows} />}
      {view === "waterfall" && <WaterfallChart rows={rows} currency={currency} />}
      {view === "treemap"   && <TreemapChart rows={rows} />}
      {view === "bar"       && <BarChartView rows={rows} currency={currency} />}
    </div>
  );
}
