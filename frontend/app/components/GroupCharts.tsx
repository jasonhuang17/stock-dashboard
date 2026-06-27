"use client";
import { useState } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, ReferenceLine, LabelList,
} from "recharts";
import type { Quote } from "@/lib/types";

type View = "cards" | "pie" | "bar";

const PALETTE = ["#1ECFD6","#EDD170","#C05640","#5BB8D4","#F0A835","#E8855A","#3A9BC1","#7EDDE4","#0D5C8C","#F5C842","#1AA5B0","#D4935A","#4DA8C8","#E8B86D","#B04030"];

function DonutChart({ quotes }: { quotes: Quote[] }) {
  const valid = quotes.filter(q => q.pct !== null);
  if (!valid.length) return <div className="neu" style={{ padding: 20, fontSize: "0.8rem" }}>資料載入中…</div>;

  const data = valid.map(q => ({ name: q.ticker, value: Math.abs(q.pct!) }));
  const maxIdx = data.reduce((mi, d, i) => d.value > data[mi].value ? i : mi, 0);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={50}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell
              key={i}
              fill={PALETTE[i % PALETTE.length]}
              fillOpacity={0.82}
              stroke="rgba(0,29,58,0.6)"
              strokeWidth={1}
              style={i === maxIdx ? { transform: "scale(1.06)", transformOrigin: "center", filter: "drop-shadow(0 0 8px rgba(30,207,214,0.4))" } : {}}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)", fontFamily: "Courier New", fontSize: 12 }}
          formatter={(v: unknown, name: unknown) => { const n = v as number; return [`${n.toFixed(2)}%`, name as string] as [string, string]; }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

function NormalizedBar({ quotes }: { quotes: Quote[] }) {
  const valid = quotes.filter(q => q.pct !== null);
  if (!valid.length) return <div className="neu" style={{ padding: 20, fontSize: "0.8rem" }}>資料載入中…</div>;

  const sorted = [...valid].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  const max = Math.max(...sorted.map(q => Math.abs(q.pct ?? 0)), 0.01);
  const data = sorted.map(q => ({ name: q.ticker, value: (q.pct ?? 0) / max * 100, pct: q.pct ?? 0 }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 10, bottom: 4 }}>
        <XAxis type="number" hide domain={[-100, 100]} />
        <YAxis type="category" dataKey="name" tick={{ fill: "#1ECFD6", fontSize: 11, fontFamily: "Courier New", fontWeight: 700 }} width={55} />
        <ReferenceLine x={0} stroke="rgba(8,120,164,0.4)" />
        <Tooltip
          contentStyle={{ background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)", fontFamily: "Courier New", fontSize: 12 }}
          formatter={(_v: unknown, _n: unknown, props: { payload?: Quote }) => [
            props?.payload ? `${(props.payload.pct ?? 0) >= 0 ? "+" : ""}${(props.payload.pct ?? 0).toFixed(2)}%` : "",
            "漲跌幅",
          ] as [string, string]}
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.value >= 0 ? "#C05640" : "#3DAA70"} fillOpacity={0.8} />
          ))}
          <LabelList
            dataKey="pct"
            position="right"
            style={{ fill: "#6899b8", fontSize: 10 }}
            formatter={(v: unknown) => { const n = v as number; return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GroupStats({ quotes }: { quotes: Quote[] }) {
  const valid = quotes.filter(q => q.pct !== null);
  const up   = valid.filter(q => (q.pct ?? 0) > 0).length;
  const down = valid.filter(q => (q.pct ?? 0) < 0).length;
  const flat = valid.length - up - down;
  return (
    <div style={{ display: "flex", gap: 20, marginBottom: 12, fontSize: "0.75rem", alignItems: "center" }}>
      <span style={{ color: "var(--red)" }}>▲ {up} UP</span>
      <span style={{ color: "var(--green)" }}>▼ {down} DOWN</span>
      <span style={{ color: "var(--blue)" }}>◆ {flat} FLAT</span>
      <span style={{ color: "var(--dim)", marginLeft: "auto", fontSize: "0.68rem" }}>
        {valid.length}/{quotes.length} loaded · 30s cache
      </span>
    </div>
  );
}

export function GroupCharts({ quotes }: { quotes: Quote[] }) {
  const [view, setView] = useState<View>("cards");
  const views: { key: View; label: string }[] = [
    { key: "cards", label: "📋 Cards" },
    { key: "pie",   label: "🥧 圓餅圖" },
    { key: "bar",   label: "📊 長條圖" },
  ];
  return (
    <div>
      <div className="tab-bar" style={{ marginBottom: 12 }}>
        {views.map(v => (
          <button key={v.key} className={`tab-btn${view === v.key ? " active" : ""}`} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      {view === "pie" && <DonutChart quotes={quotes} />}
      {view === "bar" && <NormalizedBar quotes={quotes} />}
    </div>
  );
}
