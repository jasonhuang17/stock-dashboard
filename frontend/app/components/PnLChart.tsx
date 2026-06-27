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
type Mode = "today" | "unreal";

const POS = "#C05640";
const NEG = "#3DAA70";

function color(v: number | null) { return v === null ? "#6899b8" : v >= 0 ? POS : NEG; }

function BubbleChart({ rows, mode }: { rows: PortfolioRow[]; mode: Mode }) {
  const isUnreal = mode === "unreal";
  const data = rows
    .filter(r => r.price !== null && (isUnreal ? r.unreal_gain !== null : r.today_gain !== null))
    .map(r => ({
      ticker: r.ticker,
      name: r.name ?? "",
      x: isUnreal ? (r.unreal_pct ?? 0) : (r.pct ?? 0),
      y: isUnreal ? (r.unreal_gain ?? 0) : (r.today_gain ?? 0),
      z: Math.abs((r.price ?? 0) * r.shares),
    }));

  const xs = data.map(d => d.x);
  const ys = data.map(d => d.y);
  const xMin = Math.min(...xs, 0), xMax = Math.max(...xs, 0);
  const yMin = Math.min(...ys, 0), yMax = Math.max(...ys, 0);
  const xPad = Math.max((xMax - xMin) * 0.22, 1);
  const yPad = Math.max((yMax - yMin) * 0.30, 1);
  const xDomain: [number, number] = [xMin - xPad, xMax + xPad];
  const yDomainPadded: [number, number] = [yMin - yPad, yMax + yPad];

  const yRange = Math.max(yDomainPadded[1] - yDomainPadded[0], 20);
  const yBase = Math.pow(10, Math.max(1, Math.round(Math.log10(yRange / 5))));
  const yTickMin = Math.floor(yDomainPadded[0] / yBase) * yBase;
  const yTickMax = Math.ceil(yDomainPadded[1] / yBase) * yBase;
  const yTicks: number[] = [];
  for (let t = yTickMin; t <= yTickMax + 0.01; t += yBase) yTicks.push(Math.round(t));
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
        <text x={cx} y={cy - r - (payload.name ? 15 : 5)} textAnchor="middle"
          fill="#d4eaf5" fontSize={11} fontFamily="Courier New" fontWeight={700}>
          {payload.ticker}
        </text>
        {payload.name && (
          <text x={cx} y={cy - r - 3} textAnchor="middle"
            fill="#6899b8" fontSize={10} fontFamily="Courier New">
            {payload.name}
          </text>
        )}
      </g>
    );
  };

  const xLabel = isUnreal ? "未實現%" : "今日%";
  const yLabel = isUnreal ? "未實現損益" : "今日損益";

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ScatterChart margin={{ top: 48, right: 60, bottom: 24, left: 16 }}>
        <XAxis dataKey="x" type="number" name={xLabel} domain={xDomain} tick={{ fill: "#6899b8", fontSize: 11 }} tickFormatter={v => `${v.toFixed(1)}%`} />
        <YAxis dataKey="y" type="number" name={yLabel} domain={yDomain} ticks={yTicks} tickFormatter={v => v.toLocaleString()} tick={{ fill: "#6899b8", fontSize: 11 }} />
        <Tooltip
          cursor={{ stroke: "rgba(30,207,214,0.2)" }}
          content={({ payload: pl }) => {
            const d = pl?.[0]?.payload as DotEntry | undefined;
            if (!d) return null;
            return (
              <div style={{ background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)", padding: "8px 12px", fontFamily: "Courier New", fontSize: 12 }}>
                <div style={{ color: "#1ECFD6", fontWeight: 700, marginBottom: 2 }}>{d.ticker}{d.name ? ` ${d.name}` : ""}</div>
                <div>{xLabel}：{d.x >= 0 ? "+" : ""}{d.x.toFixed(2)}%</div>
                <div style={{ color: color(d.y) }}>
                  {yLabel}：{d.y >= 0 ? "+" : ""}{d.y.toFixed(2)}
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

function WaterfallChart({ rows, currency, mode }: { rows: PortfolioRow[]; currency: Currency; mode: Mode }) {
  const isUnreal = mode === "unreal";
  const field = isUnreal ? "unreal_gain" : "today_gain";
  const label = isUnreal ? "未實現損益" : "今日損益";
  const valid = rows.filter(r => r[field] !== null);
  const sorted = [...valid].sort((a, b) => ((b[field] as number) ?? 0) - ((a[field] as number) ?? 0));
  const total = sorted.reduce((s, r) => s + ((r[field] as number) ?? 0), 0);
  const sym = currency === "TWD" ? "NT$" : "$";

  const data = [
    ...sorted.map(r => ({ name: r.name || r.ticker, value: (r[field] as number) ?? 0 })),
    { name: "合計", value: total },
  ];

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
        <XAxis dataKey="name" tick={{ fill: "#6899b8", fontSize: 11 }} />
        <YAxis tick={{ fill: "#6899b8", fontSize: 11 }} tickFormatter={v => `${sym}${v.toFixed(0)}`} />
        <Tooltip
          contentStyle={{ background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)", fontFamily: "Courier New", fontSize: 12 }}
          formatter={(v: unknown) => { const n = v as number; return [`${sym}${n.toFixed(2)}`, label] as [string, string]; }}
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

function TreemapChart({ rows, mode }: { rows: PortfolioRow[]; mode: Mode }) {
  const isUnreal = mode === "unreal";
  const data = rows
    .filter(r => r.price !== null)
    .map(r => ({
      name: r.ticker,
      cnName: r.name ?? "",
      size: Math.abs((r.price ?? 0) * r.shares),
      pct: isUnreal ? (r.unreal_pct ?? 0) : (r.pct ?? 0),
    }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <Treemap data={data} dataKey="size" nameKey="name" aspectRatio={4 / 3}
        content={(props: Record<string, unknown>) => {
          const { x, y, width, height, name, cnName, pct } = props as {
            x: number; y: number; width: number; height: number;
            name?: string; cnName?: string; pct?: number;
          };
          if (typeof pct !== "number" || !name) return <g />;
          const showCn = cnName && width > 64 && height > 44;
          return (
            <g>
              <rect x={x} y={y} width={width} height={height} fill={color(pct)} fillOpacity={0.75} stroke="rgba(0,29,58,0.8)" strokeWidth={2} />
              {width > 48 && height > 28 && (
                <>
                  <text x={x + width / 2} y={y + height / 2 - (showCn ? 14 : 6)} textAnchor="middle" fill="#d4eaf5" fontSize={13} fontFamily="Courier New" fontWeight={700}>{name}</text>
                  {showCn && (
                    <text x={x + width / 2} y={y + height / 2 + 2} textAnchor="middle" fill="#d4eaf5" fontSize={10} fontFamily="Courier New">{cnName}</text>
                  )}
                  <text x={x + width / 2} y={y + height / 2 + (showCn ? 16 : 10)} textAnchor="middle" fill="#d4eaf5" fontSize={12} fontFamily="Courier New">{`${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}</text>
                </>
              )}
            </g>
          );
        }}
      />
    </ResponsiveContainer>
  );
}

function BarChartView({ rows, currency, mode }: { rows: PortfolioRow[]; currency: Currency; mode: Mode }) {
  const isUnreal = mode === "unreal";
  const field = isUnreal ? "unreal_gain" : "today_gain";
  const label = isUnreal ? "未實現損益" : "今日損益";
  const valid = rows.filter(r => r[field] !== null);
  const sorted = [...valid].sort((a, b) => ((a[field] as number) ?? 0) - ((b[field] as number) ?? 0));
  const sym = currency === "TWD" ? "NT$" : "$";
  const hasTwNames = sorted.some(r => r.name);
  const data = sorted.map(r => ({ ...r, displayName: r.name ? `${r.ticker} ${r.name}` : r.ticker }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, sorted.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 10, bottom: 4 }}>
        <XAxis type="number" tick={{ fill: "#6899b8", fontSize: 11 }} tickFormatter={v => `${sym}${v.toFixed(0)}`} />
        <YAxis type="category" dataKey="displayName" tick={{ fill: "#1ECFD6", fontSize: hasTwNames ? 10 : 11, fontFamily: "Courier New", fontWeight: 700 }} width={hasTwNames ? 110 : 55} />
        <Tooltip
          contentStyle={{ background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)", fontFamily: "Courier New", fontSize: 12 }}
          formatter={(v: unknown) => { const n = v as number; return [`${sym}${n.toFixed(2)}`, label] as [string, string]; }}
        />
        <ReferenceLine x={0} stroke="rgba(8,120,164,0.3)" />
        <Bar dataKey={field} radius={[0, 3, 3, 0]}>
          {sorted.map((r, i) => <Cell key={i} fill={color(r[field] as number | null)} fillOpacity={0.8} />)}
          <LabelList dataKey={field} position="right" style={{ fill: "#6899b8", fontSize: 10 }} formatter={(v: unknown) => { const n = v as number; return n >= 0 ? `+${n.toFixed(0)}` : n.toFixed(0); }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PnLChart({ rows, currency }: { rows: PortfolioRow[]; currency: Currency }) {
  const [view, setView] = useState<View>("bubble");
  const [mode, setMode] = useState<Mode>("today");
  if (!rows.some(r => r.price !== null)) return null;

  const views: { key: View; label: string }[] = [
    { key: "bubble",    label: "氣泡圖" },
    { key: "waterfall", label: "瀑布圖" },
    { key: "treemap",   label: "樹狀圖" },
    { key: "bar",       label: "長條圖" },
  ];

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["today", "unreal"] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "3px 10px",
                fontSize: "0.72rem",
                fontFamily: "Courier New",
                fontWeight: 700,
                border: `1px solid ${mode === m ? "var(--teal)" : "rgba(8,120,164,0.35)"}`,
                borderRadius: 4,
                background: mode === m ? "rgba(30,207,214,0.12)" : "transparent",
                color: mode === m ? "var(--teal)" : "var(--dim)",
                cursor: "pointer",
                letterSpacing: "0.04em",
              }}
            >
              {m === "today" ? "今日損益" : "未實現損益"}
            </button>
          ))}
        </div>
        {/* Divider */}
        <span style={{ width: 1, height: 20, background: "rgba(8,120,164,0.35)", flexShrink: 0 }} />
        {/* Chart type switcher */}
        <div className="chart-switcher" style={{ margin: 0 }}>
          {views.map(v => (
            <button key={v.key} className={`chart-btn${view === v.key ? " active" : ""}`} onClick={() => setView(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {view === "bubble"    && <BubbleChart rows={rows} mode={mode} />}
      {view === "waterfall" && <WaterfallChart rows={rows} currency={currency} mode={mode} />}
      {view === "treemap"   && <TreemapChart rows={rows} mode={mode} />}
      {view === "bar"       && <BarChartView rows={rows} currency={currency} mode={mode} />}
    </div>
  );
}
