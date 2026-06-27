"""
Stock Dashboard — dark sci-fi UI
Groups: 個股 / 槓桿型 / 大盤型
Data:   yfinance (30s cache, ~15s Yahoo Finance delay)
Clock:  JS ticks every second; page data refreshes every 30s
"""
import math
import streamlit as st
import yfinance as yf
import pandas as pd
import plotly.graph_objects as go
from datetime import datetime
import pytz
import json
import os
from streamlit_sortables import sort_items
import streamlit_sortables as _st_sortables

# ── Config persistence ────────────────────────────────────────────────────────
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
_DEFAULT_GROUPS = {
    "🚀 個股": ["AAOI", "ONDS", "MU", "SNDK", "SPCX", "TSLA", "NVDA", "TSM", "AAPL", "GOOG", "AMZN"],
    "⚡ 槓桿型": ["AAOX", "ONDL", "MUU", "SNXX", "TSMX"],
    "🌐 大盤型": ["VOO", "SPY", "QQQ"],
}

_EMPTY_PORTFOLIO = {
    "美股複委託（台幣帳戶）": {"currency": "USD", "positions": {}},
    "美股複委託（美金帳戶）": {"currency": "USD", "positions": {}},
    "台股帳戶":         {"currency": "TWD", "positions": {}},
}

def load_config():
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        if "group_tickers" in data:
            raw          = data["group_tickers"]
            raw_portfolio = data.get("portfolio", {})
        else:
            raw          = data
            raw_portfolio = {}
        groups = {k: raw.get(k, list(v)) for k, v in _DEFAULT_GROUPS.items()}
        # Auto-migrate old flat format {"TICKER": {"shares":N,"avg_cost":X}}
        if raw_portfolio and "美股複委託（台幣帳戶）" not in raw_portfolio:
            first = next(iter(raw_portfolio.values()), {})
            if isinstance(first, dict) and "shares" in first:
                raw_portfolio = {
                    "美股複委託（台幣帳戶）": {"currency": "USD", "positions": raw_portfolio},
                    "美股複委託（美金帳戶）": {"currency": "USD", "positions": {}},
                    "台股帳戶":         {"currency": "TWD", "positions": {}},
                }
        return groups, raw_portfolio or _EMPTY_PORTFOLIO
    except (FileNotFoundError, json.JSONDecodeError):
        return {k: list(v) for k, v in _DEFAULT_GROUPS.items()}, _EMPTY_PORTFOLIO

def save_config(group_tickers: dict, portfolio: dict):
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump({"group_tickers": group_tickers, "portfolio": portfolio},
                      f, ensure_ascii=False, indent=2)
    except Exception:
        pass

# ── Page setup ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="◈ Stock Dashboard",
    layout="wide",
    page_icon="📈",
    initial_sidebar_state="collapsed",
)


# Persist editable ticker lists across reruns (loads from config.json if exists)
if "group_tickers" not in st.session_state:
    _cfg_groups, _cfg_portfolio = load_config()
    st.session_state.group_tickers = _cfg_groups
    st.session_state.portfolio = _cfg_portfolio
elif "portfolio" not in st.session_state:
    _, _cfg_portfolio = load_config()
    st.session_state.portfolio = _cfg_portfolio

# Migrate in-session portfolio to multi-account format if still in old flat format
_port = st.session_state.portfolio
if _port and "美股複委託（台幣帳戶）" not in _port:
    _first = next(iter(_port.values()), {})
    if isinstance(_first, dict) and "shares" in _first:
        st.session_state.portfolio = {
            "美股複委託（台幣帳戶）": {"currency": "USD", "positions": dict(_port)},
            "美股複委託（美金帳戶）": {"currency": "USD", "positions": {}},
            "台股帳戶":         {"currency": "TWD", "positions": {}},
        }

# ── Stock groups — edit here to customize ────────────────────────────────────
GROUPS = {
    "🚀 個股": ("AAOI", "ONDS", "MU", "SNDK", "SPCX", "TSLA", "NVDA", "TSM", "AAPL", "GOOG", "AMZN"),
    "⚡ 槓桿型": ("AAOX", "ONDL", "MUU", "SNXX", "TSMX"),
    "🌐 大盤型": ("VOO", "SPY", "QQQ"),
}

NEON_PALETTE = [
    "#1ECFD6", "#EDD170", "#0878A4", "#C05640", "#003D73",
    "#1ECFD6", "#EDD170", "#0878A4", "#C05640", "#003D73", "#1ECFD6",
]

# Per-stock colors for donut chart — derived from theme palette
CHART_PALETTE = [
    "#1ECFD6",  # teal (主題青)
    "#EDD170",  # gold (主題金)
    "#C05640",  # burnt sienna (主題磚紅)
    "#5BB8D4",  # sky blue (淡化 #0878A4)
    "#F0A835",  # amber (加深 #EDD170)
    "#E8855A",  # terra cotta (淡化 #C05640)
    "#3A9BC1",  # cerulean (青藍中間值)
    "#7EDDE4",  # ice teal (淡化 #1ECFD6)
    "#0D5C8C",  # deep ocean (深化 #0878A4)
    "#F5C842",  # bright gold (亮化 #EDD170)
    "#1AA5B0",  # dark teal (深化 #1ECFD6)
    "#D4935A",  # warm amber (暖橙中間值)
    "#4DA8C8",  # mid blue-teal
    "#E8B86D",  # pale gold
    "#B04030",  # deep red (深化 #C05640)
]

# ── Global CSS ────────────────────────────────────────────────────────────────
st.markdown("""
<style>
#MainMenu, footer { visibility: hidden; }
[data-testid="stHeader"]      { display: none !important; }
[data-testid="stToolbar"]     { display: none !important; }
[data-testid="stDecoration"]  { display: none !important; }

/* Hide autorefresh iframe and its Streamlit wrapper */
iframe[height="0"] { display: none !important; }
[data-testid="stCustomComponentV1"]:has(iframe[height="0"]),
.element-container:has(iframe[height="0"]) {
    display: none !important;
    height: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
}

/* Page background */
body, .stApp { background-color: #001d3a !important; }

/* Kill the header-reserved padding at every selector level */
.main .block-container,
[data-testid="stMainBlockContainer"],
.stMainBlockContainer {
    padding-top: 0.3rem !important;
    padding-bottom: 0.5rem !important;
    max-width: 100% !important;
    padding-left: 2rem !important;
    padding-right: 2rem !important;
}
/* Streamlit injects padding via the inner section wrapper too */
section[data-testid="stMain"] > div:first-child {
    padding-top: 0 !important;
}

/* ─ Header ─ */
.dash-title {
    font-family: 'Courier New', monospace;
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: #d4eaf5;
    text-shadow: 0 0 22px rgba(30,207,214,0.35);
}
.status-pill {
    display: inline-flex;
    align-items: center;
    padding: 3px 13px;
    border-radius: 20px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    font-family: 'Courier New', monospace;
}
.s-open   { background:rgba(30,207,214,0.12);  border:1px solid rgba(30,207,214,0.4);  color:#1ECFD6; }
.s-pre    { background:rgba(237,209,112,0.1);  border:1px solid rgba(237,209,112,0.35); color:#EDD170; }
.s-closed { background:rgba(192,86,64,0.12);   border:1px solid rgba(192,86,64,0.4);   color:#C05640; }

/* ─ Stock card ─ */
.stock-card {
    background: linear-gradient(135deg, rgba(0,61,115,0.55), rgba(8,120,164,0.12));
    border: 1px solid rgba(8,120,164,0.38);
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 8px;
    font-family: 'Courier New', monospace;
    min-height: 92px;
    transition: border-color 0.22s ease, box-shadow 0.22s ease;
}
.stock-card:hover {
    border-color: rgba(30,207,214,0.6);
    box-shadow: 0 0 22px rgba(30,207,214,0.12);
}
/* Ticker — large, bold, teal */
.ct {
    font-size: 1.0rem;
    font-weight: 800;
    color: #1ECFD6;
    letter-spacing: 0.18em;
    margin-bottom: 6px;
}
.cp { font-size: 1.1rem; color: #d4eaf5; font-weight: 600; margin-bottom: 5px; }
.cc { font-size: 0.9rem; font-weight: 700; }
.pos { color: #C05640; }
.neg { color: #3DAA70; }
.neu { color: #4a6a8a; }

/* ─ Button ─ */
.stButton > button {
    background: rgba(8,120,164,0.15) !important;
    border: 1px solid rgba(8,120,164,0.45) !important;
    color: #1ECFD6 !important;
    font-family: 'Courier New', monospace !important;
    font-size: 0.78rem !important;
    letter-spacing: 0.1em !important;
    border-radius: 6px !important;
    transition: all 0.2s !important;
}
.stButton > button:hover {
    background: rgba(30,207,214,0.15) !important;
    border-color: rgba(30,207,214,0.6) !important;
    box-shadow: 0 0 12px rgba(30,207,214,0.15) !important;
}

/* ─ Tabs ─ */
.stTabs [data-baseweb="tab-list"] {
    gap: 4px;
    background: transparent;
    border-bottom: 1px solid rgba(8,120,164,0.3);
}
.stTabs [data-baseweb="tab"] {
    background: transparent !important;
    color: #4a6a8a !important;
    font-weight: 700;
    letter-spacing: 0.08em;
    font-size: 0.82rem;
    padding: 8px 22px;
    border-radius: 6px 6px 0 0;
    font-family: 'Courier New', monospace;
}
.stTabs [aria-selected="true"] {
    background: rgba(30,207,214,0.08) !important;
    color: #1ECFD6 !important;
    border-bottom: 2px solid #1ECFD6 !important;
}

hr { border-color: rgba(8,120,164,0.25) !important; }

/* ─ Sortables — lock frame height so container doesn't jump during drag ─ */
[data-testid="stCustomComponentV1"] {
    min-height: 52px !important;
    overflow: visible !important;
}
[data-testid="stCustomComponentV1"] iframe {
    min-height: 52px !important;
    height: 52px !important;
}

/* ─ Expander ─ */
[data-testid="stExpander"] {
    border: 1px solid rgba(8,120,164,0.3) !important;
    border-radius: 8px !important;
    background: rgba(0,61,115,0.2) !important;
    margin-bottom: 12px !important;
}
[data-testid="stExpander"] summary {
    color: #1ECFD6 !important;
    font-family: 'Courier New', monospace !important;
    font-size: 0.82rem !important;
    font-weight: 700 !important;
    letter-spacing: 0.08em !important;
}

/* ─ Text input ─ */
.stTextInput input {
    background: rgba(0,29,58,0.8) !important;
    border: 1px solid rgba(8,120,164,0.4) !important;
    border-radius: 6px !important;
    color: #d4eaf5 !important;
    font-family: 'Courier New', monospace !important;
    font-size: 0.9rem !important;
}
.stTextInput input:focus {
    border-color: #1ECFD6 !important;
    box-shadow: 0 0 8px rgba(30,207,214,0.2) !important;
}

/* ─ Ticker chip remove buttons ─ */
.chip-btn > button {
    background: rgba(0,61,115,0.5) !important;
    border: 1px solid rgba(8,120,164,0.35) !important;
    color: #d4eaf5 !important;
    font-family: 'Courier New', monospace !important;
    font-size: 0.72rem !important;
    padding: 2px 8px !important;
    border-radius: 20px !important;
    letter-spacing: 0.05em !important;
    margin-bottom: 4px !important;
}
.chip-btn > button:hover {
    border-color: #C05640 !important;
    color: #C05640 !important;
}

/* ─ Radio label + options ─ */
[data-testid="stRadio"] label,
[data-testid="stRadio"] label span,
[data-testid="stRadio"] p {
    color: #d4eaf5 !important;
}
</style>
""", unsafe_allow_html=True)


# ── Helpers ───────────────────────────────────────────────────────────────────
def contrast_text(hex_bg: str) -> str:
    """Return dark or light text colour depending on background luminance."""
    h = hex_bg.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return "#001d3a" if luminance > 0.5 else "#f0f8ff"


def market_status():
    et = pytz.timezone("America/New_York")
    now = datetime.now(et)
    if now.weekday() >= 5:
        return "CLOSED", "s-closed", now
    h = now.hour + now.minute / 60
    if 9.5 <= h < 16:
        return "OPEN", "s-open", now
    if (4 <= h < 9.5) or (16 <= h < 20):
        return "PRE/POST", "s-pre", now
    return "CLOSED", "s-closed", now


@st.cache_data(ttl=28, show_spinner=False)
def fetch_quotes(tickers: tuple):
    if not tickers:
        return []
    try:
        raw = yf.download(
            list(tickers), period="5d", interval="1d",
            auto_adjust=True, progress=False, threads=True,
        )
    except Exception:
        return [{"ticker": t, "price": None, "pct": None} for t in tickers]

    out = []
    for t in tickers:
        price = pct = None
        try:
            col = raw["Close"][t] if isinstance(raw.columns, pd.MultiIndex) else raw["Close"]
            closes = col.dropna()
            if len(closes) >= 2:
                prev, curr = float(closes.iloc[-2]), float(closes.iloc[-1])
                pct = (curr - prev) / prev * 100
                price = curr
        except Exception:
            pass
        out.append({"ticker": t, "price": price, "pct": pct})
    return out


@st.cache_data(ttl=60, show_spinner=False)
def fetch_premarket(tickers: tuple):
    if not tickers:
        return []
    et = pytz.timezone("America/New_York")
    try:
        raw = yf.download(
            list(tickers), period="1d", interval="1m",
            auto_adjust=True, prepost=True, progress=False, threads=True,
        )
        daily = yf.download(
            list(tickers), period="5d", interval="1d",
            auto_adjust=True, progress=False, threads=True,
        )
    except Exception:
        return [{"ticker": t, "price": None, "pct": None, "prev_close": None, "time": None}
                for t in tickers]

    out = []
    for t in tickers:
        price = pct = prev_close = ts = None
        try:
            dc = daily["Close"][t] if isinstance(daily.columns, pd.MultiIndex) else daily["Close"]
            dc = dc.dropna()
            if len(dc) >= 2:
                prev_close = float(dc.iloc[-2])
            elif len(dc) == 1:
                prev_close = float(dc.iloc[-1])

            mc = raw["Close"][t] if isinstance(raw.columns, pd.MultiIndex) else raw["Close"]
            mc = mc.dropna()
            if len(mc) >= 1:
                price = float(mc.iloc[-1])
                ts = mc.index[-1].astimezone(et)
                if prev_close:
                    pct = (price - prev_close) / prev_close * 100
        except Exception:
            pass
        out.append({"ticker": t, "price": price, "pct": pct, "prev_close": prev_close, "time": ts})
    return out


@st.cache_data(ttl=300, show_spinner=False)
def _ticker_exists(ticker: str) -> bool:
    try:
        df = yf.download(ticker, period="5d", interval="1d", progress=False)
        return not df.empty
    except Exception:
        return False


@st.cache_data(ttl=300, show_spinner=False)
def _resolve_tw_ticker(bare: str) -> str:
    """Resolve a bare TW ticker to its full yfinance symbol (tries .TW then .TWO)."""
    for suffix in (".TW", ".TWO"):
        try:
            df = yf.download(bare + suffix, period="2d", interval="1d", progress=False)
            if not df.empty:
                return bare + suffix
        except Exception:
            pass
    return bare + ".TW"


@st.cache_data(ttl=300, show_spinner=False)
def _ticker_exists_tw(bare: str) -> bool:
    """Check if a bare TW ticker exists on Yahoo Finance (.TW or .TWO)."""
    for suffix in (".TW", ".TWO"):
        try:
            df = yf.download(bare + suffix, period="2d", interval="1d", progress=False)
            if not df.empty:
                return True
        except Exception:
            pass
    return False


def card_html(t, price, pct):
    if price is None:
        return (f'<div class="stock-card">'
                f'<div class="ct">{t}</div>'
                f'<div class="cp neu">—</div>'
                f'<div class="cc neu">N / A</div>'
                f'</div>')
    cls   = "pos" if pct >= 0 else "neg"
    arrow = "▲" if pct >= 0 else "▼"
    sign  = "+" if pct >= 0 else ""
    return (f'<div class="stock-card">'
            f'<div class="ct">{t}</div>'
            f'<div class="cp">${price:,.2f}</div>'
            f'<div class="cc {cls}">{arrow} {sign}{pct:.2f}%</div>'
            f'</div>')


def premarket_card_html(t, price, pct, prev_close, ts):
    if price is None:
        return (f'<div class="stock-card">'
                f'<div class="ct">{t}</div>'
                f'<div class="cp neu">—</div>'
                f'<div class="cc neu">N / A</div>'
                f'</div>')
    cls   = "pos" if pct >= 0 else "neg"
    arrow = "▲" if pct >= 0 else "▼"
    sign  = "+" if pct >= 0 else ""
    time_str = ts.strftime("%H:%M ET") if ts else "—"
    return (f'<div class="stock-card">'
            f'<div class="ct">{t}</div>'
            f'<div class="cp">${price:,.2f}</div>'
            f'<div class="cc {cls}">{arrow} {sign}{pct:.2f}%</div>'
            f'<div style="font-family:Courier New;font-size:0.68rem;color:#2d4a6a;margin-top:4px;">'
            f'vs prev close ${prev_close:,.2f} · {time_str}</div>'
            f'</div>')


def render_grid(results, n_cols):
    for i in range(0, len(results), n_cols):
        chunk = results[i:i+n_cols]
        chunk += [None] * (n_cols - len(chunk))
        cols = st.columns(n_cols)
        for col, item in zip(cols, chunk):
            with col:
                if item:
                    st.markdown(card_html(item["ticker"], item["price"], item["pct"]),
                                unsafe_allow_html=True)


def donut_chart(results):
    valid = [(r["ticker"], r["pct"]) for r in results if r["pct"] is not None]
    fig = go.Figure()

    if not valid:
        fig.add_annotation(text="NO DATA", x=0.5, y=0.5, showarrow=False,
                           font=dict(size=14, color="#4a6a8a", family="Courier New"))
    else:
        labels = [v[0] for v in valid]
        values = [max(abs(v[1]), 0.1) for v in valid]
        pct_str = [f"{'+' if p >= 0 else ''}{p:.2f}%" for _, p in valid]
        # Merge ticker + % into one HTML string so both render bold
        text   = [f"<b>{t}</b><br><b>{s}</b>" for (t, _), s in zip(valid, pct_str)]
        hover  = pct_str[:]
        colors = (CHART_PALETTE * 4)[:len(valid)]

        pos  = [(i, p) for i, (_, p) in enumerate(valid) if p > 0]
        pull = [0.0] * len(valid)
        if pos:
            top_i, top_p = max(pos, key=lambda x: x[1])
            pull[top_i]  = 0.06
            center_txt   = f"<b>{labels[top_i]}</b><br>+{top_p:.2f}%"
            center_color = colors[top_i]
        else:
            center_txt   = "◈"
            center_color = "#1ECFD6"

        fig.add_trace(go.Pie(
            labels=labels,
            values=values,
            text=text,
            hole=0.58,
            marker=dict(colors=colors, line=dict(color="#001d3a", width=2)),
            textinfo="text",
            textfont=dict(color=[contrast_text(c) for c in colors], size=14, family="Courier New"),
            hovertemplate="<b>%{label}</b>  %{customdata}<extra></extra>",
            customdata=hover,
            pull=pull,
            insidetextorientation="auto",
        ))
        fig.add_annotation(
            text=center_txt,
            x=0.5, y=0.5, showarrow=False,
            font=dict(size=13, color=center_color, family="Courier New"),
        )

    fig.update_layout(
        showlegend=True,
        legend=dict(
            orientation="h",
            x=0.5, xanchor="center", y=-0.05,
            font=dict(color="#d4eaf5", size=11, family="Courier New"),
            bgcolor="rgba(0,0,0,0)",
        ),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        height=580,
        margin=dict(l=20, r=20, t=40, b=60),
        title=dict(text="◈ 漲跌比重", font=dict(color="#1ECFD6", size=11, family="Courier New"), x=0.5),
    )
    return fig


def bar_chart(results):
    valid = [(r["ticker"], r["pct"]) for r in results if r["pct"] is not None]
    if not valid:
        fig = go.Figure()
        fig.add_annotation(text="NO DATA", x=0.5, y=0.5, showarrow=False,
                           font=dict(size=14, color="#4a6a8a", family="Courier New"))
        fig.update_layout(paper_bgcolor="rgba(0,0,0,0)", height=300)
        return fig

    valid.sort(key=lambda x: x[1])
    tickers = [v[0] for v in valid]
    pcts    = [v[1] for v in valid]
    colors  = ["#C05640" if p >= 0 else "#3DAA70" for p in pcts]
    text    = [f"+{p:.2f}%" if p >= 0 else f"{p:.2f}%" for p in pcts]
    max_abs = max(abs(p) for p in pcts) or 1
    max_len = max(len(t) for t in tickers)

    # ── Normalise to [-1, 1] so bars fill the chart regardless of actual % ──
    # Bars always scale relative to the biggest mover; actual % shown in labels.
    scale  = max_abs
    d_pcts = [p / scale for p in pcts]

    # Smaller box: d_bh is the half-width of the centre box in normalised units
    d_bh    = max(0.02 * max_len, 0.06)          # e.g. 4-char ticker → 0.08
    d_bases = [ d_bh if dp >= 0 else -d_bh for dp in d_pcts]
    d_widths= [max(dp - d_bh, 0) if dp >= 0 else min(dp + d_bh, 0) for dp in d_pcts]
    padded  = [t.center(max_len) for t in tickers]

    x_range   = [-1.25, 1.25]
    label_gap = 0.04

    # Custom x-axis ticks that show real % values
    tvs = [-1.0, -0.5, 0.0, 0.5, 1.0]
    tick_text = [f"{v * scale:.2f}%" for v in tvs]

    fig = go.Figure()

    # ── Trace 1: coloured bars ───────────────────────────────────────────────
    fig.add_trace(go.Bar(
        x=d_widths, y=tickers, base=d_bases,
        orientation="h",
        marker=dict(color=colors, line=dict(width=0)),
        hovertemplate="<b>%{y}</b>: %{customdata}<extra></extra>",
        customdata=text,
        showlegend=False,
    ))

    # ── Trace 2: centre box as Bar (data-space, guaranteed flush with bars) ──
    fig.add_trace(go.Bar(
        x=[d_bh * 2] * len(tickers),
        y=tickers,
        base=[-d_bh] * len(tickers),
        orientation="h",
        marker=dict(color="#001d3a", line=dict(color="#0878A4", width=1.5)),
        text=padded,
        textposition="inside",
        insidetextanchor="middle",
        textfont=dict(color="#1ECFD6", size=13, family="Courier New"),
        hoverinfo="skip",
        showlegend=False,
    ))

    # ── Traces 3/4: % labels — always outside the box ───────────────────────
    pos = [(t, dp, tx) for t, dp, tx in zip(tickers, d_pcts, text) if dp >= 0]
    neg = [(t, dp, tx) for t, dp, tx in zip(tickers, d_pcts, text) if dp <  0]

    if pos:
        fig.add_trace(go.Scatter(
            x=[max(dp, d_bh) + label_gap for _, dp, _ in pos],
            y=[t for t, _, _ in pos],
            mode="text", text=[tx for _, _, tx in pos],
            textposition="middle right",
            textfont=dict(color="#d4eaf5", size=12, family="Courier New"),
            hoverinfo="skip", showlegend=False,
        ))
    if neg:
        fig.add_trace(go.Scatter(
            x=[min(dp, -d_bh) - label_gap for _, dp, _ in neg],
            y=[t for t, _, _ in neg],
            mode="text", text=[tx for _, _, tx in neg],
            textposition="middle left",
            textfont=dict(color="#d4eaf5", size=12, family="Courier New"),
            hoverinfo="skip", showlegend=False,
        ))

    # ── Title annotation at x=0 (data coord) → aligns with centre boxes ─────
    fig.add_annotation(
        x=0, y=1.04, xref="x", yref="paper",
        text="◈ 漲跌幅",
        showarrow=False, xanchor="center", yanchor="bottom",
        font=dict(color="#1ECFD6", size=11, family="Courier New"),
    )

    fig.update_layout(
        barmode="overlay",
        xaxis=dict(
            range=x_range,
            tickvals=tvs, ticktext=tick_text,
            zeroline=True, zerolinecolor="#0878A4", zerolinewidth=2,
            gridcolor="rgba(8,120,164,0.15)",
            tickfont=dict(color="#4a6a8a", family="Courier New", size=10),
        ),
        yaxis=dict(showticklabels=False, gridcolor="rgba(8,120,164,0.1)"),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,61,115,0.25)",
        height=max(280, len(valid) * 56),
        margin=dict(l=20, r=90, t=40, b=30),
        showlegend=False,
    )
    return fig


# ── Portfolio helper functions ─────────────────────────────────────────────────

_ACCT_MAP = [
    ("美股複委託（台幣帳戶）", "USD"),
    ("美股複委託（美金帳戶）", "USD"),
    ("台股帳戶",         "TWD"),
]


def _fmt_cost(val, currency):
    return f"NT${val:.2f}" if currency == "TWD" else f"${val:.3f}"


def _portfolio_rows(acct_key):
    positions = (st.session_state.portfolio
                 .get(acct_key, {})
                 .get("positions", {}))
    if not positions:
        return []
    is_twd = st.session_state.portfolio.get(acct_key, {}).get("currency") == "TWD"
    if is_twd:
        bare_to_full = {b: _resolve_tw_ticker(b) for b in positions}
        quotes       = fetch_quotes(tuple(bare_to_full.values()))
        full_to_bare = {v: k for k, v in bare_to_full.items()}
        quote_map    = {full_to_bare.get(q["ticker"], q["ticker"]): q for q in quotes}
    else:
        quotes    = fetch_quotes(tuple(positions.keys()))
        quote_map = {q["ticker"]: q for q in quotes}
    rows = []
    for ticker, pos in positions.items():
        q        = quote_map.get(ticker, {})
        price    = q.get("price")
        pct      = q.get("pct")
        shares   = pos["shares"]
        avg_cost = pos["avg_cost"]
        if price is not None and pct is not None:
            prev_close  = price / (1 + pct / 100)
            per_share   = price - prev_close
            today_gain  = per_share * shares
            unreal_gain = (price - avg_cost) * shares
            unreal_pct  = (price - avg_cost) / avg_cost * 100 if avg_cost else 0.0
        else:
            prev_close = per_share = today_gain = unreal_gain = unreal_pct = None
        rows.append({
            "ticker": ticker, "shares": shares, "avg_cost": avg_cost,
            "price": price, "pct": pct, "prev_close": prev_close,
            "per_share": per_share, "today_gain": today_gain,
            "unreal_gain": unreal_gain, "unreal_pct": unreal_pct,
        })
    return rows



@st.fragment
def _manage_reorder_fragment(acct_key, currency):
    positions = st.session_state.portfolio.get(acct_key, {}).get("positions", {})
    _sort_key = f"show_sort_port_{acct_key}"
    _show_sort = st.session_state.get(_sort_key, False)
    if st.button("↕ 收起排序 ▲" if _show_sort else "↕ 調整持倉順序 ▼",
                 key=f"sort_toggle_{acct_key}"):
        st.session_state[_sort_key] = not _show_sort

    if st.session_state.get(_sort_key, False) and positions:
        _drag_key    = f"port_drag_{acct_key}"
        _ticker_list = list(positions.keys())

        # sort_items stores state as [{'header': None, 'items': [...]}] (list of dicts).
        # Extract inner list with .get() before set-comparing — avoids TypeError on sort().
        _stored = st.session_state.get(_drag_key)
        if isinstance(_stored, list) and _stored and isinstance(_stored[0], dict):
            if set(_stored[0].get("items", [])) != set(_ticker_list):
                del st.session_state[_drag_key]

        _style = """
        body, html { background: #001d3a !important; margin: 0; padding: 0; }
        .sortable-component {
            background: transparent;
            border: none;
            padding: 4px 0;
            min-height: 44px;
        }
        .sortable-item {
            background-color: rgba(0,45,90,0.9) !important;
            border: 1px solid rgba(8,120,164,0.4) !important;
            color: #7ecde4 !important;
            font-family: 'Courier New', monospace !important;
            font-weight: 700 !important;
            font-size: 0.8rem !important;
            letter-spacing: 0.08em !important;
            border-radius: 5px !important;
        }
        .sortable-item:hover {
            background-color: rgba(8,120,164,0.25) !important;
            border-color: rgba(30,207,214,0.45) !important;
            color: #1ECFD6 !important;
        }
        """
        # Call _component_func directly with explicit height so the iframe renders
        # at the correct size inside @st.fragment (without height it defaults to 0px).
        _default = [{"header": None, "items": _ticker_list}]
        _raw = _st_sortables._component_func(
            items=_default,
            direction="horizontal",
            customStyle=_style,
            default=_default,
            key=_drag_key,
            height=80,
        )
        _new_order = _raw[0]["items"] if isinstance(_raw, list) and _raw else _ticker_list

        if set(_new_order) == set(_ticker_list) and _new_order != _ticker_list:
            reordered = {t: positions[t] for t in _new_order if t in positions}
            st.session_state.portfolio[acct_key]["positions"] = reordered
            save_config(st.session_state.group_tickers, st.session_state.portfolio)
            st.rerun(scope="fragment")


@st.fragment
def _pnl_sort_fragment(rows, currency, sort_key):
    cost_lbl = "成本 (NT$)" if currency == "TWD" else "成本 (USD)"
    gain_sfx = " (TWD)"    if currency == "TWD" else " (USD)"

    _ss_key = f"pnl_sort_{sort_key}"
    if _ss_key not in st.session_state:
        st.session_state[_ss_key] = {"col": None, "dir": "desc"}
    ss = st.session_state[_ss_key]

    COLS = [
        ("代號",                  "ticker",      1.2),
        ("股數",                  "shares",      0.8),
        (cost_lbl,                "avg_cost",    1.1),
        ("現價",                  "price",       1.1),
        ("單股漲跌",              "per_share",   1.5),
        (f"今日損益{gain_sfx}",   "today_gain",  1.3),
        ("未實現損益",            "unreal_gain", 1.6),
    ]
    widths = [c[2] for c in COLS]

    # ── Header row ────────────────────────────────────────────────────────────
    hcols = st.columns(widths)
    for col_widget, (label, col_key, _) in zip(hcols, COLS):
        with col_widget:
            is_active = ss["col"] == col_key
            indicator = (" ↑" if ss["dir"] == "asc" else " ↓") if is_active else ""
            if st.button(
                f"{label}{indicator}",
                key=f"sorthdr_{sort_key}_{col_key}",
                use_container_width=True,
            ):
                if is_active:
                    initial_dir = "asc" if col_key == "ticker" else "desc"
                    if ss["dir"] != initial_dir:
                        # third click → reset to custom/default
                        new_state = {"col": None, "dir": "desc"}
                    else:
                        # second click → toggle direction
                        new_state = {"col": col_key, "dir": "desc" if initial_dir == "asc" else "asc"}
                else:
                    # first click → set column with initial direction
                    new_state = {"col": col_key, "dir": "asc" if col_key == "ticker" else "desc"}
                st.session_state[_ss_key] = new_state
                st.rerun(scope="fragment")

    # ── Apply sort ────────────────────────────────────────────────────────────
    display_rows = list(rows)
    if ss["col"] is not None:
        ck      = ss["col"]
        reverse = ss["dir"] == "desc"
        valid   = [r for r in display_rows if r.get(ck) is not None]
        nones   = [r for r in display_rows if r.get(ck) is None]
        valid.sort(key=lambda r: r[ck].lower() if isinstance(r[ck], str) else r[ck], reverse=reverse)
        display_rows = valid + nones

    # ── Data rows (st.columns for perfect alignment) ──────────────────────────
    C = "padding:6px 2px;font-family:Courier New;font-size:0.82rem;border-bottom:1px solid rgba(8,120,164,0.15);"
    for r in display_rows:
        if r["price"] is None:
            price_str = single_str = today_str = unreal_str = "—"
            s_color = t_color = u_color = "#4a6a8a"
        else:
            ps       = r["per_share"]
            ps_sign  = "+" if ps >= 0 else ""
            pct_sign = "+" if r["pct"] >= 0 else ""
            t_sign   = "+" if r["today_gain"] >= 0 else ""
            u_sign   = "+" if r["unreal_gain"] >= 0 else ""
            if currency == "TWD":
                price_str  = f"NT${r['price']:,.2f}"
                single_str = f"{ps_sign}NT${abs(ps):.2f} ({pct_sign}{r['pct']:.2f}%)"
                today_str  = f"{t_sign}NT${abs(r['today_gain']):,.0f}"
                unreal_str = f"{u_sign}NT${abs(r['unreal_gain']):,.0f} ({'+' if r['unreal_pct']>=0 else ''}{r['unreal_pct']:.1f}%)"
            else:
                price_str  = f"${r['price']:,.2f}"
                single_str = f"{ps_sign}${abs(ps):.3f} ({pct_sign}{r['pct']:.2f}%)"
                today_str  = f"{t_sign}${abs(r['today_gain']):,.2f}"
                unreal_str = f"{u_sign}${abs(r['unreal_gain']):,.2f} ({'+' if r['unreal_pct']>=0 else ''}{r['unreal_pct']:.1f}%)"
            s_color = "#C05640" if ps >= 0 else "#3DAA70"
            t_color = "#C05640" if r["today_gain"] >= 0 else "#3DAA70"
            u_color = "#C05640" if r["unreal_gain"] >= 0 else "#3DAA70"

        dcols = st.columns(widths)
        with dcols[0]:
            st.markdown(f"<div style='{C}text-align:center;color:#1ECFD6;font-weight:800;'>{r['ticker']}</div>", unsafe_allow_html=True)
        with dcols[1]:
            st.markdown(f"<div style='{C}text-align:right;color:#d4eaf5;'>{r['shares']:g}</div>", unsafe_allow_html=True)
        with dcols[2]:
            st.markdown(f"<div style='{C}text-align:right;color:#d4eaf5;'>{_fmt_cost(r['avg_cost'], currency)}</div>", unsafe_allow_html=True)
        with dcols[3]:
            st.markdown(f"<div style='{C}text-align:right;color:#d4eaf5;'>{price_str}</div>", unsafe_allow_html=True)
        with dcols[4]:
            st.markdown(f"<div style='{C}text-align:right;color:{s_color};'>{single_str}</div>", unsafe_allow_html=True)
        with dcols[5]:
            st.markdown(f"<div style='{C}text-align:right;color:{t_color};'>{today_str}</div>", unsafe_allow_html=True)
        with dcols[6]:
            st.markdown(f"<div style='{C}text-align:right;color:{u_color};'>{unreal_str}</div>", unsafe_allow_html=True)


def _render_pnl_table(rows, currency, sort_key="pnl"):
    total_today   = sum(r["today_gain"]              for r in rows if r["price"] is not None)
    total_prev_mv = sum(r["prev_close"] * r["shares"] for r in rows if r["price"] is not None)
    total_unreal  = sum(r["unreal_gain"]              for r in rows if r["price"] is not None)
    has_data      = any(r["price"] is not None        for r in rows)
    _pnl_sort_fragment(rows, currency, sort_key)
    return total_today, total_prev_mv, total_unreal, has_data


def _render_summary_bar(total_today, total_prev_mv, total_unreal, currency):
    total_pct = (total_today / total_prev_mv * 100) if total_prev_mv else 0
    t_sign = "+" if total_today >= 0 else ""
    u_sign = "+" if total_unreal >= 0 else ""
    t_cls  = "pos" if total_today >= 0 else "neg"
    u_cls  = "pos" if total_unreal >= 0 else "neg"
    if currency == "TWD":
        t_fmt = f"NT${abs(total_today):,.0f}"
        u_fmt = f"NT${abs(total_unreal):,.0f}"
    else:
        t_fmt = f"${abs(total_today):,.2f}"
        u_fmt = f"${abs(total_unreal):,.2f}"
    tp_sign = "+" if total_pct >= 0 else ""
    st.markdown(f"""
    <div style='font-family:Courier New;font-size:0.88rem;
        padding:10px 14px;
        background:rgba(0,29,58,0.6);
        border:1px solid rgba(8,120,164,0.35);border-radius:8px;
        display:flex;gap:40px;align-items:center;'>
      <span style='color:#4a6a8a;'>今日總損益</span>
      <span class='{t_cls}' style='font-weight:800;font-size:1rem;'>
        {t_sign}{t_fmt}
      </span>
      <span class='{t_cls}'>({tp_sign}{total_pct:.2f}%)</span>
      <span style='color:#2d4a6a;margin-left:auto;font-size:0.75rem;'>未實現總損益</span>
      <span class='{u_cls}' style='font-size:0.88rem;'>{u_sign}{u_fmt}</span>
    </div>""", unsafe_allow_html=True)


def _draw_bubble(rows, currency, key):
    br       = [r for r in rows if r["price"] is not None]
    if not br:
        return
    b_x      = [r["pct"]               for r in br]
    b_y      = [r["today_gain"]        for r in br]
    b_labels = [r["ticker"]            for r in br]
    b_mv     = [r["price"]*r["shares"] for r in br]
    b_colors = ["#C05640" if p >= 0 else "#3DAA70" for p in b_x]
    max_mv   = max(b_mv) or 1
    b_sizes  = [max(math.sqrt(mv / max_mv) * 140, 24) for mv in b_mv]
    cur_sym  = "NT$" if currency == "TWD" else "$"
    tick_fmt = ",.0f" if currency == "TWD" else ",.2f"
    hover = [
        (f"<b>{r['ticker']}</b><br>"
         f"今日%：{'+' if r['pct']>=0 else ''}{r['pct']:.2f}%<br>"
         f"今日損益：{'+' if r['today_gain']>=0 else ''}{cur_sym}{abs(r['today_gain']):,.2f}<br>"
         f"持倉市值：{cur_sym}{r['price']*r['shares']:,.2f}")
        for r in br
    ]
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=b_x, y=b_y, mode="markers+text",
        marker=dict(size=b_sizes, color=b_colors, opacity=0.82,
                    line=dict(color="rgba(30,207,214,0.4)", width=1.5)),
        text=b_labels, textposition="middle center",
        textfont=dict(color=[contrast_text(c) for c in b_colors],
                      size=12, family="Courier New", weight="bold"),
        hovertext=hover, hoverinfo="text",
    ))
    fig.add_hline(y=0, line=dict(color="rgba(8,120,164,0.5)", width=1, dash="dot"))
    fig.add_vline(x=0, line=dict(color="rgba(8,120,164,0.5)", width=1, dash="dot"))
    fig.update_layout(
        xaxis=dict(title="今日漲跌%",
                   title_font=dict(color="#4a6a8a", size=10, family="Courier New"),
                   tickformat=".2f", ticksuffix="%",
                   tickfont=dict(color="#4a6a8a", size=10, family="Courier New"),
                   gridcolor="rgba(8,120,164,0.12)", zeroline=False),
        yaxis=dict(title=f"今日損益 ({currency})",
                   title_font=dict(color="#4a6a8a", size=10, family="Courier New"),
                   tickprefix=cur_sym, tickformat=tick_fmt,
                   tickfont=dict(color="#4a6a8a", size=10, family="Courier New"),
                   gridcolor="rgba(8,120,164,0.12)", zeroline=False),
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,29,58,0.4)",
        height=420, margin=dict(l=60, r=20, t=36, b=50), showlegend=False,
        title=dict(text="◈ 今日損益氣泡圖  （氣泡大小 = 持倉市值）",
                   font=dict(color="#1ECFD6", size=11, family="Courier New"), x=0.5),
    )
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False}, key=key)


def _draw_waterfall(rows, currency, key):
    br = sorted([r for r in rows if r["price"] is not None],
                key=lambda r: r["today_gain"], reverse=True)
    if not br:
        return
    cur_sym = "NT$" if currency == "TWD" else "$"
    dec     = 0 if currency == "TWD" else 2
    tickers = [r["ticker"] for r in br]
    gains   = [r["today_gain"] for r in br]
    txt     = [f"{'+' if g>=0 else ''}{cur_sym}{abs(g):,.{dec}f}" for g in gains]
    fig = go.Figure(go.Waterfall(
        orientation="v",
        measure=["relative"] * len(tickers) + ["total"],
        x=tickers + ["合計"],
        y=gains + [None],
        connector={"line": {"color": "rgba(8,120,164,0.3)", "width": 1, "dash": "dot"}},
        increasing={"marker": {"color": "#C05640", "line": {"width": 0}}},
        decreasing={"marker": {"color": "#3DAA70", "line": {"width": 0}}},
        totals={"marker":    {"color": "#EDD170",  "line": {"width": 0}}},
        text=txt + [""], textposition="outside",
        textfont=dict(color="#d4eaf5", size=11, family="Courier New"),
    ))
    fig.update_layout(
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,29,58,0.4)",
        height=400, margin=dict(l=20, r=20, t=40, b=30),
        yaxis=dict(title=f"今日損益 ({currency})",
                   title_font=dict(color="#4a6a8a", size=10, family="Courier New"),
                   tickprefix=cur_sym,
                   tickfont=dict(color="#4a6a8a", size=10, family="Courier New"),
                   gridcolor="rgba(8,120,164,0.12)",
                   zeroline=True, zerolinecolor="rgba(8,120,164,0.5)", zerolinewidth=1),
        xaxis=dict(tickfont=dict(color="#d4eaf5", size=12,
                                 family="Courier New", weight="bold")),
        showlegend=False,
        title=dict(text="◈ 今日損益瀑布圖",
                   font=dict(color="#1ECFD6", size=11, family="Courier New"), x=0.5),
    )
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False}, key=key)


def _draw_treemap(rows, currency, key):
    br = [r for r in rows if r["price"] is not None]
    if not br:
        return
    cur_sym = "NT$" if currency == "TWD" else "$"
    dec     = 0 if currency == "TWD" else 2
    tickers  = [r["ticker"]            for r in br]
    mv       = [r["price"]*r["shares"] for r in br]
    pcts     = [r["pct"]               for r in br]
    gains    = [r["today_gain"]        for r in br]
    fig = go.Figure(go.Treemap(
        labels=tickers, parents=[""] * len(tickers), values=mv,
        customdata=list(zip(pcts, gains)),
        texttemplate="<b>%{label}</b><br>%{customdata[0]:+.2f}%",
        hovertemplate=(
            "<b>%{label}</b><br>"
            f"今日漲跌: %{{customdata[0]:+.2f}}%<br>"
            f"今日損益: {cur_sym}%{{customdata[1]:,.{dec}f}}<br>"
            f"持倉市值: {cur_sym}%{{value:,.{dec}f}}"
            "<extra></extra>"
        ),
        marker=dict(
            colors=pcts,
            colorscale=[[0, "#3DAA70"], [0.5, "#0d2a42"], [1, "#C05640"]],
            cmid=0, showscale=False,
            line=dict(color="#001d3a", width=2),
        ),
        textfont=dict(color="#ffffff", size=13, family="Courier New"),
    ))
    fig.update_layout(
        paper_bgcolor="rgba(0,0,0,0)",
        height=400, margin=dict(l=0, r=0, t=40, b=0),
        title=dict(text="◈ 持倉熱力圖  （大小＝市值，顏色＝漲跌%）",
                   font=dict(color="#1ECFD6", size=11, family="Courier New"), x=0.5),
    )
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False}, key=key)


def _draw_bar_pnl(rows, currency, key):
    br = sorted([r for r in rows if r["price"] is not None],
                key=lambda r: r["today_gain"])
    if not br:
        return
    cur_sym = "NT$" if currency == "TWD" else "$"
    dec     = 0 if currency == "TWD" else 2
    tickers = [r["ticker"]     for r in br]
    gains   = [r["today_gain"] for r in br]
    colors  = ["#C05640" if g >= 0 else "#3DAA70" for g in gains]
    txt     = [f"{'+' if g>=0 else ''}{cur_sym}{abs(g):,.{dec}f}" for g in gains]
    fig = go.Figure(go.Bar(
        x=gains, y=tickers, orientation="h",
        marker=dict(color=colors, line=dict(width=0)),
        text=txt, textposition="outside",
        textfont=dict(color="#d4eaf5", size=11, family="Courier New"),
        hovertemplate="<b>%{y}</b>  %{text}<extra></extra>",
    ))
    fig.add_vline(x=0, line=dict(color="rgba(8,120,164,0.6)", width=1.5))
    fig.update_layout(
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,29,58,0.4)",
        height=max(280, len(br) * 52 + 80),
        margin=dict(l=20, r=110, t=40, b=30),
        xaxis=dict(title=f"今日損益 ({currency})",
                   title_font=dict(color="#4a6a8a", size=10, family="Courier New"),
                   tickprefix=cur_sym,
                   tickfont=dict(color="#4a6a8a", size=10, family="Courier New"),
                   gridcolor="rgba(8,120,164,0.12)", zeroline=False),
        yaxis=dict(tickfont=dict(color="#1ECFD6", size=12,
                                 family="Courier New", weight="bold"),
                   gridcolor="rgba(8,120,164,0.1)"),
        showlegend=False,
        title=dict(text="◈ 今日損益長條圖",
                   font=dict(color="#1ECFD6", size=11, family="Courier New"), x=0.5),
    )
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False}, key=key)


def _render_pnl_chart(rows, currency, key_prefix="chart"):
    if not any(r["price"] is not None for r in rows):
        return
    chart_type = st.radio(
        "圖表類型",
        ["氣泡圖", "瀑布圖", "樹狀圖", "長條圖"],
        horizontal=True,
        key=f"{key_prefix}_type",
    )
    fig_key = f"{key_prefix}_fig"
    if chart_type == "氣泡圖":
        _draw_bubble(rows, currency, key=fig_key)
    elif chart_type == "瀑布圖":
        _draw_waterfall(rows, currency, key=fig_key)
    elif chart_type == "樹狀圖":
        _draw_treemap(rows, currency, key=fig_key)
    else:
        _draw_bar_pnl(rows, currency, key=fig_key)


def _render_manage_tab(acct_key, currency):
    note = "新增持倉後自動儲存，重啟仍保留。"
    if currency == "TWD":
        note += " 輸入純代號即可（例如 2330），系統自動識別上市／上櫃。"
    st.markdown(
        f"<div style='font-family:Courier New;font-size:0.75rem;"
        f"color:#4a6a8a;margin-bottom:10px;'>{note}</div>",
        unsafe_allow_html=True,
    )

    n_key = f"port_add_n_{acct_key}"
    if n_key not in st.session_state:
        st.session_state[n_key] = 0
    _n = st.session_state[n_key]

    cost_label  = "平均成本 (NT$)" if currency == "TWD" else "平均成本 (USD)"
    cost_fmt    = "%.2f"           if currency == "TWD" else "%.3f"
    cost_step   = 0.01             if currency == "TWD" else 0.001
    placeholder = "e.g. 2330 / 6488" if currency == "TWD" else "e.g. AAPL"

    _ticker_key = f"port_ticker_{acct_key}_{_n}"
    def _to_upper(_k=_ticker_key, _twd=(currency == "TWD")):
        val = st.session_state[_k].upper()
        if _twd:
            val = val.removesuffix(".TWO").removesuffix(".TW")
        st.session_state[_k] = val

    a1, a2, a3, a4 = st.columns([2, 2, 2, 1])
    with a1:
        new_ticker = st.text_input("股票代號", placeholder=placeholder,
                                   key=_ticker_key, on_change=_to_upper)
    with a2:
        new_shares = st.number_input("股數（整數）", min_value=0, step=1,
                                     value=None,
                                     key=f"port_shares_{acct_key}_{_n}")
    with a3:
        new_cost = st.number_input(cost_label, min_value=0.0, step=cost_step,
                                   format=cost_fmt, value=None,
                                   key=f"port_cost_{acct_key}_{_n}")
    with a4:
        st.markdown("<div style='height:28px'></div>", unsafe_allow_html=True)
        _add_clicked = st.button("新增", key=f"port_add_{acct_key}", use_container_width=True)

    if _add_clicked:
        t = new_ticker.strip().upper()
        if currency == "TWD":
            t = t.removesuffix(".TWO").removesuffix(".TW")
        _err = None
        if not t:
            _err = "請輸入股票代號"
        elif new_shares is None or new_shares <= 0:
            _err = "請輸入股數（需大於 0）"
        elif new_cost is None or new_cost <= 0:
            _err = "請輸入平均成本（需大於 0）"
        elif currency == "TWD" and not _ticker_exists_tw(t):
            _err = f"找不到台股代號「{t}」，請確認代號是否正確"
        elif currency != "TWD" and not _ticker_exists(t):
            _err = f"找不到股票代號「{t}」，請確認代號是否正確"
        if _err:
            st.error(_err)
        else:
            dec = 2 if currency == "TWD" else 3
            st.session_state.portfolio[acct_key]["positions"][t] = {
                "shares": int(new_shares), "avg_cost": round(float(new_cost), dec),
            }
            save_config(st.session_state.group_tickers, st.session_state.portfolio)
            st.session_state[n_key] += 1
            st.rerun()

    st.markdown("<hr>", unsafe_allow_html=True)

    positions = st.session_state.portfolio.get(acct_key, {}).get("positions", {})
    if not positions:
        st.markdown(
            "<div style='font-family:Courier New;color:#2d4a6a;font-size:0.82rem;'>"
            "尚無持倉，請在上方新增。</div>",
            unsafe_allow_html=True,
        )
        return

    edit_key = f"editing_port_{acct_key}"
    _editing = st.session_state.get(edit_key)
    _COLS    = [1.4, 1.4, 1.8, 0.8, 0.8]
    cost_hdr = "平均成本 (NT$)" if currency == "TWD" else "平均成本 (USD)"
    hc = st.columns(_COLS)
    for col, label in zip(hc, ["代號", "股數", cost_hdr, "", ""]):
        col.markdown(
            f"<div style='font-family:Courier New;font-size:0.7rem;color:#4a6a8a;'>{label}</div>",
            unsafe_allow_html=True,
        )
    st.markdown(
        "<hr style='border:none;border-top:1px solid rgba(8,120,164,0.25);margin:4px 0 6px;'>",
        unsafe_allow_html=True,
    )

    for ticker, pos in list(positions.items()):
        is_edit = (_editing == ticker)
        c1, c2, c3, c4, c5 = st.columns(_COLS)
        with c1:
            st.markdown(
                f"<div style='font-family:Courier New;font-weight:700;"
                f"color:#1ECFD6;font-size:0.9rem;padding-top:8px;'>{ticker}</div>",
                unsafe_allow_html=True,
            )
        if is_edit:
            with c2:
                edited_shares = st.number_input(
                    "股數", min_value=0, step=1, value=int(pos["shares"]),
                    key=f"edit_shares_{acct_key}_{ticker}", label_visibility="collapsed",
                )
            with c3:
                edited_cost = st.number_input(
                    "成本", min_value=0.0, step=cost_step, format=cost_fmt,
                    value=float(pos["avg_cost"]),
                    key=f"edit_cost_{acct_key}_{ticker}", label_visibility="collapsed",
                )
            with c4:
                if st.button("儲存", key=f"port_save_{acct_key}_{ticker}", use_container_width=True):
                    dec = 2 if currency == "TWD" else 3
                    st.session_state.portfolio[acct_key]["positions"][ticker] = {
                        "shares": int(edited_shares),
                        "avg_cost": round(float(edited_cost), dec),
                    }
                    save_config(st.session_state.group_tickers, st.session_state.portfolio)
                    st.session_state.pop(edit_key, None)
                    st.rerun()
            with c5:
                if st.button("取消", key=f"port_cancel_{acct_key}_{ticker}", use_container_width=True):
                    st.session_state.pop(edit_key, None)
                    st.rerun()
        else:
            with c2:
                st.markdown(
                    f"<div style='font-family:Courier New;color:#d4eaf5;"
                    f"font-size:0.85rem;padding-top:8px;"
                    f"display:flex;justify-content:flex-end;gap:4px;'>"
                    f"<span style='text-align:right;'>{int(pos['shares']):,}</span>"
                    f"<span>股</span></div>",
                    unsafe_allow_html=True,
                )
            with c3:
                st.markdown(
                    f"<div style='font-family:Courier New;color:#d4eaf5;"
                    f"font-size:0.85rem;padding-top:8px;'>{_fmt_cost(pos['avg_cost'], currency)}</div>",
                    unsafe_allow_html=True,
                )
            with c4:
                if st.button("編輯", key=f"port_edit_{acct_key}_{ticker}", use_container_width=True):
                    st.session_state[edit_key] = ticker
                    st.rerun()
            with c5:
                if st.button("刪除", key=f"port_rm_{acct_key}_{ticker}", use_container_width=True):
                    del st.session_state.portfolio[acct_key]["positions"][ticker]
                    save_config(st.session_state.group_tickers, st.session_state.portfolio)
                    st.session_state.pop(edit_key, None)
                    st.rerun()

    # ── Drag-to-reorder ────────────────────────────────────────────────────
    st.markdown("<div style='height:8px'></div>", unsafe_allow_html=True)
    _manage_reorder_fragment(acct_key, currency)


@st.fragment(run_every=30)
def _dashboard_fragment():
    # ── Header ────────────────────────────────────────────────────────────────
    ms_text, ms_cls, et_now = market_status()

    hc1, hc2 = st.columns([5, 1])
    with hc1:
        st.markdown(f"""
        <div style="display:flex;align-items:center;gap:14px;padding:2px 0 0;">
            <span class="dash-title">◈ STOCK DASHBOARD</span>
            <span class="status-pill {ms_cls}">{ms_text}</span>
            <span style="color:#475569;font-family:'Courier New';font-size:0.78rem;">
                ET {et_now.strftime('%H:%M:%S')}
            </span>
        </div>""", unsafe_allow_html=True)
    
    with hc2:
        if st.button("↻ REFRESH", use_container_width=True):
            st.cache_data.clear()
            st.rerun()
    
    # Countdown + thin divider — all in one compact HTML block, no extra Streamlit elements
    st.components.v1.html("""
    <div style="display:flex;align-items:center;gap:0;margin-top:2px;">
        <div id="cd" style="
            color:#1ECFD6;
            font-family:'Courier New',monospace;
            font-size:0.7rem;
            letter-spacing:0.06em;
            flex:1;
        "></div>
    </div>
    <hr style="border:none;border-top:1px solid rgba(8,120,164,0.25);margin:4px 0 0;">
    <script>
    // Force-remove padding Streamlit sets for the header bar
    (function(){
        const sel = [
            '[data-testid="stMainBlockContainer"]',
            '[data-testid="stMain"] > div',
            '.block-container'
        ];
        sel.forEach(s => {
            const el = window.parent.document.querySelector(s);
            if (el) el.style.paddingTop = '0.3rem';
        });
    })();
    
    let n = 30;
    (function tick() {
        document.getElementById('cd').innerText = '↻  next data update in ' + n + 's  ·  prices ~15s delayed (Yahoo Finance)';
        n = n > 0 ? n - 1 : 30;
        setTimeout(tick, 1000);
    })();
    </script>""", height=26)
    
    # ── Tabs ──────────────────────────────────────────────────────────────────────
    tabs = st.tabs(["💼 持倉"] + list(GROUPS.keys()))
    
    for tab, gname in zip(tabs[1:], GROUPS.keys()):
        with tab:
            tickers = tuple(st.session_state.group_tickers[gname])
            results = fetch_quotes(tickers)
    
            valid = [r for r in results if r["pct"] is not None]
            up    = sum(1 for r in valid if r["pct"] > 0)
            down  = sum(1 for r in valid if r["pct"] < 0)
            flat  = len(valid) - up - down
    
            st.markdown(f"""
            <div style="display:flex;gap:20px;margin-bottom:12px;
                        font-family:'Courier New';font-size:0.75rem;align-items:center;">
                <span style="color:#C05640;">▲&nbsp;{up}&nbsp;UP</span>
                <span style="color:#3DAA70;">▼&nbsp;{down}&nbsp;DOWN</span>
                <span style="color:#0878A4;">◆&nbsp;{flat}&nbsp;FLAT</span>
                <span style="color:#2d4a6a;margin-left:auto;font-size:0.68rem;">
                    {len(valid)}/{len(tickers)} loaded · 30s cache
                </span>
            </div>""", unsafe_allow_html=True)
    
            n      = len(tickers)
            n_cols = n if n <= 3 else (3 if n <= 6 else 4)
    
            view_card, view_pie, view_bar, view_pre = st.tabs(["📋 Cards", "🥧 圓餅圖", "📊 長條圖", "🌅 盤前/後"])
    
            with view_card:
                # ── Sort ─────────────────────────────────────────────────────
                sort_col, _ = st.columns([2, 6])
                with sort_col:
                    sort_by = st.selectbox(
                        "排序", ["自訂順序", "漲幅 ↓", "漲幅 ↑", "代號 A→Z", "價格 ↓"],
                        key=f"sort_{gname}", label_visibility="collapsed",
                    )
                def sort_results(rs):
                    if sort_by == "自訂順序":
                        return rs
                    def key(r):
                        if sort_by == "漲幅 ↓":
                            return -(r["pct"] or -999)
                        if sort_by == "漲幅 ↑":
                            return (r["pct"] or 999)
                        if sort_by == "代號 A→Z":
                            return r["ticker"]
                        return -(r["price"] or 0)
                    return sorted(rs, key=key)
                sorted_results = sort_results(results)
    
                # ── Add / remove tickers ─────────────────────────────────────
                with st.expander("＋ 編輯股票清單"):
                    _grp_inp_key = f"inp_{gname}"
                    def _to_upper_grp(_k=_grp_inp_key):
                        st.session_state[_k] = st.session_state[_k].upper()
    
                    c_input, c_btn = st.columns([4, 1])
                    with c_input:
                        new_t = st.text_input(
                            "新增代號", placeholder="e.g. META",
                            key=_grp_inp_key, label_visibility="collapsed",
                            on_change=_to_upper_grp,
                        )
                    with c_btn:
                        _grp_add_clicked = st.button("新增", key=f"add_{gname}", use_container_width=True)
    
                    if _grp_add_clicked:
                        t = new_t.strip().upper()
                        if not t:
                            st.error("請輸入股票代號")
                        elif t in st.session_state.group_tickers[gname]:
                            st.warning(f"「{t}」已在清單中")
                        elif not _ticker_exists(t):
                            st.error(f"找不到股票代號「{t}」，請確認代號是否正確")
                        else:
                            st.session_state.group_tickers[gname].append(t)
                            save_config(st.session_state.group_tickers, st.session_state.portfolio)
                            st.cache_data.clear()
                            st.rerun()
    
                    # Chip-style remove buttons
                    st.markdown(
                        "<div style='font-family:Courier New;font-size:0.72rem;"
                        "color:#4a6a8a;margin:6px 0 4px;'>點擊代號移除：</div>",
                        unsafe_allow_html=True,
                    )
                    chip_cols = st.columns(min(len(tickers), 8))
                    for ci, t in enumerate(tickers):
                        with chip_cols[ci % len(chip_cols)]:
                            st.markdown('<div class="chip-btn">', unsafe_allow_html=True)
                            if st.button(f"✕ {t}", key=f"rm_{gname}_{t}"):
                                st.session_state.group_tickers[gname].remove(t)
                                save_config(st.session_state.group_tickers, st.session_state.portfolio)
                                st.cache_data.clear()
                                st.rerun()
                            st.markdown("</div>", unsafe_allow_html=True)
    
                if sort_by == "自訂順序":
                    _show_drag = st.session_state.get(f"show_drag_{gname}", False)
                    drag_label = "↕ 收起排序 ▲" if _show_drag else "↕ 調整排序順序 ▼"
                    if st.button(drag_label, key=f"toggle_drag_{gname}"):
                        _show_drag = not _show_drag
                        st.session_state[f"show_drag_{gname}"] = _show_drag
    
                    if _show_drag:
                        _sortable_style = """
                        .sortable-component {
                            background: rgba(0,29,58,0.7);
                            border: 1px solid rgba(8,120,164,0.3);
                            border-radius: 8px;
                            padding: 6px 8px;
                            min-height: 44px;
                        }
                        .sortable-item {
                            background-color: rgba(0,45,90,0.9) !important;
                            border: 1px solid rgba(8,120,164,0.4) !important;
                            color: #7ecde4 !important;
                            font-family: 'Courier New', monospace !important;
                            font-weight: 700 !important;
                            font-size: 0.8rem !important;
                            letter-spacing: 0.08em !important;
                            border-radius: 5px !important;
                        }
                        .sortable-item:hover {
                            background-color: rgba(8,120,164,0.25) !important;
                            border-color: rgba(30,207,214,0.45) !important;
                            color: #1ECFD6 !important;
                        }
                        """
                        new_order = sort_items(
                            list(st.session_state.group_tickers[gname]),
                            direction="horizontal",
                            custom_style=_sortable_style,
                            key=f"drag_{gname}",
                        )
                        if new_order != st.session_state.group_tickers[gname]:
                            st.session_state.group_tickers[gname] = new_order
                            save_config(st.session_state.group_tickers, st.session_state.portfolio)
                            order_map = {t: i for i, t in enumerate(new_order)}
                            sorted_results = sorted(results, key=lambda r: order_map.get(r["ticker"], 999))
    
                render_grid(sorted_results, n_cols)
    
            with view_pie:
                st.plotly_chart(
                    donut_chart(results),
                    use_container_width=True,
                    config={"displayModeBar": False},
                )
    
            with view_bar:
                st.plotly_chart(
                    bar_chart(results),
                    use_container_width=True,
                    config={"displayModeBar": False},
                )
    
            with view_pre:
                ms_now, _, _ = market_status()
                if ms_now == "OPEN":
                    label = "盤中報價（含盤前延伸）"
                    note  = "市場交易中 · 1 分鐘延遲 · 對比前一交易日收盤"
                elif ms_now == "PRE/POST":
                    label = "盤前 / 盤後報價"
                    note  = "盤前 04:00–09:30 ET  |  盤後 16:00–20:00 ET · 對比前一交易日收盤"
                else:
                    label = "最後盤後報價"
                    note  = "市場已收盤 · 顯示最後一筆延伸交易報價"
    
                st.markdown(
                    f"<div style='font-family:Courier New;font-size:0.72rem;"
                    f"color:#4a6a8a;margin-bottom:10px;'>{note}</div>",
                    unsafe_allow_html=True,
                )
                pre_results = fetch_premarket(tickers)
                for i in range(0, len(pre_results), n_cols):
                    chunk = pre_results[i:i+n_cols]
                    chunk += [None] * (n_cols - len(chunk))
                    cols = st.columns(n_cols)
                    for col, item in zip(cols, chunk):
                        with col:
                            if item:
                                st.markdown(
                                    premarket_card_html(
                                        item["ticker"], item["price"], item["pct"],
                                        item["prev_close"], item["time"],
                                    ),
                                    unsafe_allow_html=True,
                                )
    
    # ── 持倉 Tab ──────────────────────────────────────────────────────────────────
    with tabs[0]:
        acct_tabs = st.tabs([
            "📊 整體損益",
            "🇹🇼 美股複委託（台幣帳戶）",
            "💵 美股複委託（美金帳戶）",
            "🇹🇼 台股帳戶",
        ])
    
        # ── 整體損益 ─────────────────────────────────────────────────────────────
        with acct_tabs[0]:
            _usd_rows_by_acct = {
                "美股複委託（台幣帳戶）": _portfolio_rows("美股複委託（台幣帳戶）"),
                "美股複委託（美金帳戶）": _portfolio_rows("美股複委託（美金帳戶）"),
            }
            usd_rows = _usd_rows_by_acct["美股複委託（台幣帳戶）"] + _usd_rows_by_acct["美股複委託（美金帳戶）"]
            twd_rows = _portfolio_rows("台股帳戶")
    
            if not usd_rows and not twd_rows:
                st.markdown(
                    "<div style='font-family:Courier New;color:#2d4a6a;font-size:0.82rem;'>"
                    "尚無持倉，請先在各帳戶分頁新增。</div>",
                    unsafe_allow_html=True,
                )
            else:
                if usd_rows:
                    st.markdown(
                        "<div style='font-family:Courier New;color:#EDD170;"
                        "font-size:0.82rem;font-weight:700;letter-spacing:0.12em;"
                        "margin:8px 0 12px;'>◈ 美股市場 (USD)</div>",
                        unsafe_allow_html=True,
                    )
                    _sub_totals = []
                    for _sub_ak, _sub_label in [
                        ("美股複委託（台幣帳戶）", "🇹🇼 美股複委託（台幣帳戶）"),
                        ("美股複委託（美金帳戶）", "💵 美股複委託（美金帳戶）"),
                    ]:
                        _sub_rows = _usd_rows_by_acct[_sub_ak]
                        if not _sub_rows:
                            continue
                        st.markdown(
                            f"<div style='font-family:Courier New;font-size:0.74rem;font-weight:700;"
                            f"color:#7ecde4;letter-spacing:0.08em;"
                            f"padding:4px 0 4px 10px;"
                            f"border-left:2px solid rgba(30,207,214,0.45);"
                            f"margin:8px 0 6px;'>{_sub_label}</div>",
                            unsafe_allow_html=True,
                        )
                        _st, _spm, _su, _shd = _render_pnl_table(_sub_rows, "USD", sort_key=f"ov_{_sub_ak}")
                        _sub_totals.append((_st, _spm, _su, _shd))
                        st.markdown("<div style='height:6px'></div>", unsafe_allow_html=True)
    
                    st.markdown(
                        "<hr style='border-color:rgba(8,120,164,0.3);margin:12px 0 10px;'>",
                        unsafe_allow_html=True,
                    )
                    if _sub_totals:
                        _t  = sum(x[0] for x in _sub_totals)
                        _pm = sum(x[1] for x in _sub_totals)
                        _u  = sum(x[2] for x in _sub_totals)
                        _hd = any(x[3] for x in _sub_totals)
                        if _hd:
                            _render_summary_bar(_t, _pm, _u, "USD")
                    _render_pnl_chart(usd_rows, "USD", key_prefix="overall_usd")
    
                if twd_rows:
                    if usd_rows:
                        st.markdown("<div style='margin-top:28px;'></div>", unsafe_allow_html=True)
                    st.markdown(
                        "<div style='font-family:Courier New;color:#EDD170;"
                        "font-size:0.82rem;font-weight:700;letter-spacing:0.12em;"
                        "margin:8px 0 10px;'>◈ 台股市場 (TWD)</div>",
                        unsafe_allow_html=True,
                    )
                    _t, _pm, _u, _hd = _render_pnl_table(twd_rows, "TWD", sort_key="ov_twd")
                    st.markdown(
                        "<hr style='border-color:rgba(8,120,164,0.3);margin:12px 0 10px;'>",
                        unsafe_allow_html=True,
                    )
                    if _hd:
                        _render_summary_bar(_t, _pm, _u, "TWD")
                    _render_pnl_chart(twd_rows, "TWD", key_prefix="overall_twd")
    
        # ── Per-account tabs ──────────────────────────────────────────────────────
        for _acct_tab, (_acct_key, _currency) in zip(acct_tabs[1:], _ACCT_MAP):
            with _acct_tab:
                pnl_tab, manage_tab = st.tabs(["💰 今日損益", "📝 持倉管理"])
    
                with pnl_tab:
                    rows = _portfolio_rows(_acct_key)
                    if not rows:
                        st.markdown(
                            "<div style='font-family:Courier New;color:#2d4a6a;font-size:0.82rem;'>"
                            "尚無持倉，請先至「📝 持倉管理」新增。</div>",
                            unsafe_allow_html=True,
                        )
                    else:
                        _t, _pm, _u, _hd = _render_pnl_table(rows, _currency, sort_key=_acct_key)
                        st.markdown(
                            "<hr style='border-color:rgba(8,120,164,0.3);margin:12px 0 10px;'>",
                            unsafe_allow_html=True,
                        )
                        if _hd:
                            _render_summary_bar(_t, _pm, _u, _currency)
                        else:
                            st.markdown(
                                "<div style='font-family:Courier New;color:#2d4a6a;font-size:0.82rem;'>"
                                "無法取得報價，請稍後再試。</div>",
                                unsafe_allow_html=True,
                            )
                        _render_pnl_chart(rows, _currency, key_prefix=f"acct_{_acct_key}")
    
                with manage_tab:
                    _render_manage_tab(_acct_key, _currency)
    
_dashboard_fragment()

# ── Footer ────────────────────────────────────────────────────────────────────
st.markdown("""
<div style='font-family:"Courier New",monospace;font-size:0.68rem;
    color:#2d4a6a;text-align:center;
    padding:18px 0 6px;
    border-top:1px solid rgba(8,120,164,0.15);margin-top:24px;'>
    ◈ &nbsp;Stock Dashboard &nbsp;·&nbsp; Made by <span style='color:#4a6a8a;'>Jason Huang</span>
    &nbsp;·&nbsp; Data via Yahoo Finance &nbsp;·&nbsp; 2026
</div>""", unsafe_allow_html=True)
