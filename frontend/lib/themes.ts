export interface ThemeColors {
  bg: string; text: string; dim: string;
  blue: string; teal: string; gold: string;
}

export interface ColorTheme {
  id: string;
  name: string;
  colors: ThemeColors;
}

export const colorThemes: ColorTheme[] = [
  {
    id: "dark-cyber",
    name: "Dark Cyber",
    colors: { bg: "#001D3A", text: "#D4EAF5", dim: "#6899B8", blue: "#0878A4", teal: "#1ECFD6", gold: "#EDD170" },
  },
  {
    id: "ocean-saas",
    name: "Ocean SaaS",
    colors: { bg: "#F8FAFC", text: "#0F172A", dim: "#64748B", blue: "#E2E8F0", teal: "#2563EB", gold: "#14B8A6" },
  },
  {
    id: "forest-calm",
    name: "Forest Calm",
    colors: { bg: "#F7F7EF", text: "#1F2937", dim: "#6B7280", blue: "#DDE7D3", teal: "#166534", gold: "#D97706" },
  },
  {
    id: "warm-earth",
    name: "Warm Earth",
    colors: { bg: "#FDF6E3", text: "#292524", dim: "#78716C", blue: "#E7D8BF", teal: "#9A3412", gold: "#EAB308" },
  },
  {
    id: "purple-product",
    name: "Purple Product",
    colors: { bg: "#FAF5FF", text: "#18181B", dim: "#71717A", blue: "#E9D5FF", teal: "#7C3AED", gold: "#06B6D4" },
  },
  {
    id: "dark-neon",
    name: "Dark Neon",
    colors: { bg: "#0F172A", text: "#F8FAFC", dim: "#94A3B8", blue: "#334155", teal: "#8B5CF6", gold: "#A3E635" },
  },
  {
    id: "finance-trust",
    name: "Finance Trust",
    colors: { bg: "#F8FAFC", text: "#111827", dim: "#6B7280", blue: "#D1FAE5", teal: "#0F766E", gold: "#F59E0B" },
  },
  {
    id: "coffee-cream",
    name: "Coffee Cream",
    colors: { bg: "#FFFBEB", text: "#2A1A12", dim: "#7C6F64", blue: "#F5E6CC", teal: "#6B3F2A", gold: "#A16207" },
  },
  {
    id: "minimal-mono",
    name: "Minimal Mono",
    colors: { bg: "#F9FAFB", text: "#111827", dim: "#6B7280", blue: "#E5E7EB", teal: "#111827", gold: "#3B82F6" },
  },
];

export const DEFAULT_THEME_ID = "dark-cyber";
export const THEME_KEY = "stock-dashboard-theme";

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function applyTheme(theme: ColorTheme) {
  const root = document.documentElement;
  const c = theme.colors;
  root.style.setProperty("--bg",          c.bg);
  root.style.setProperty("--text",        c.text);
  root.style.setProperty("--dim",         c.dim);
  root.style.setProperty("--blue",        c.blue);
  root.style.setProperty("--teal",        c.teal);
  root.style.setProperty("--gold",        c.gold);
  root.style.setProperty("--card-bg",     hexToRgba(c.blue, 0.35));
  root.style.setProperty("--card-border", hexToRgba(c.blue, 0.50));
}

export function loadSavedTheme(): ColorTheme {
  if (typeof window === "undefined") return colorThemes[0];
  const id = localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME_ID;
  return colorThemes.find(t => t.id === id) ?? colorThemes[0];
}

export function saveTheme(id: string) {
  localStorage.setItem(THEME_KEY, id);
}
