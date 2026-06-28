"use client";
import { useState, useEffect, useRef } from "react";
import { colorThemes, applyTheme, loadSavedTheme, saveTheme } from "@/lib/themes";
import { api } from "@/lib/api";

export function ThemeSelector() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(loadSavedTheme().id);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  function select(id: string) {
    const theme = colorThemes.find(t => t.id === id)!;
    applyTheme(theme);
    saveTheme(id);
    setActiveId(id);
    setOpen(false);
    api.setSettings({ theme: id }).catch(() => {});
  }

  const active = colorThemes.find(t => t.id === activeId) ?? colorThemes[0];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="切換主題"
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "3px 10px", borderRadius: 20, cursor: "pointer",
          border: `1px solid ${open ? "var(--teal)" : "rgba(8,120,164,0.4)"}`,
          background: open ? "rgba(30,207,214,0.08)" : "transparent",
          fontFamily: "Courier New", fontSize: "0.68rem", fontWeight: 700,
          letterSpacing: "0.06em", color: "var(--dim)",
        }}
      >
        <span style={{ display: "flex", gap: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: active.colors.teal, flexShrink: 0 }} />
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: active.colors.gold, flexShrink: 0 }} />
        </span>
        THEME
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200,
          background: "#001d3a", border: "1px solid rgba(8,120,164,0.4)",
          borderRadius: 8, padding: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6,
          width: 270,
        }}>
          {colorThemes.map(theme => {
            const isActive = theme.id === activeId;
            return (
              <button
                key={theme.id}
                onClick={() => select(theme.id)}
                style={{
                  cursor: "pointer", border: `1px solid ${isActive ? theme.colors.teal : "rgba(8,120,164,0.3)"}`,
                  borderRadius: 6, overflow: "hidden", padding: 0, background: "none",
                  outline: isActive ? `2px solid ${theme.colors.teal}` : "none",
                  outlineOffset: 1,
                }}
              >
                {/* Color preview */}
                <div style={{
                  background: theme.colors.bg,
                  borderBottom: `1px solid ${theme.colors.blue}`,
                  height: 28,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "0 6px",
                }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: theme.colors.teal, flexShrink: 0 }} />
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: theme.colors.gold, flexShrink: 0 }} />
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: theme.colors.dim, flexShrink: 0 }} />
                </div>
                {/* Name */}
                <div style={{
                  background: "#001828", padding: "4px 4px 5px",
                  fontSize: "0.62rem", fontFamily: "Courier New", fontWeight: 700,
                  letterSpacing: "0.04em", color: isActive ? "#1ecfd6" : "#6899b8",
                  textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {isActive ? "✓ " : ""}{theme.name}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
