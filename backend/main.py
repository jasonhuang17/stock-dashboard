"""
Stock Dashboard — FastAPI backend
Shares config.json with the Streamlit app (read/write).
Run: uvicorn main:app --reload --port 8000
"""
import json
import os
import threading
from datetime import datetime
from typing import Optional

import pandas as pd
import pytz
import yfinance as yf
from cachetools import TTLCache
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Stock Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Config ────────────────────────────────────────────────────────────────────
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config.json")

_DEFAULT_GROUPS = {
    "🚀 個股": ["AAOI", "ONDS", "MU", "SNDK", "SPCX", "TSLA", "NVDA", "TSM", "AAPL", "GOOG", "AMZN"],
    "⚡ 槓桿型": ["AAOX", "ONDL", "MUU", "SNXX", "TSMX"],
    "🌐 大盤型": ["VOO", "SPY", "QQQ"],
}

_EMPTY_PORTFOLIO = {
    "複委託（台幣戶）": {"currency": "USD", "positions": {}},
    "複委託（美金戶）": {"currency": "USD", "positions": {}},
    "台股帳戶":         {"currency": "TWD", "positions": {}},
}

_config_lock = threading.Lock()


def load_config() -> tuple[dict, dict]:
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        raw = data.get("group_tickers", data)
        raw_portfolio = data.get("portfolio", {})
        groups = {k: raw.get(k, list(v)) for k, v in _DEFAULT_GROUPS.items()}
        # Migrate old flat portfolio {"TICKER": {"shares":N, "avg_cost":X}}
        if raw_portfolio and "複委託（台幣戶）" not in raw_portfolio:
            first = next(iter(raw_portfolio.values()), {})
            if isinstance(first, dict) and "shares" in first:
                raw_portfolio = {
                    "複委託（台幣戶）": {"currency": "USD", "positions": raw_portfolio},
                    "複委託（美金戶）": {"currency": "USD", "positions": {}},
                    "台股帳戶":         {"currency": "TWD", "positions": {}},
                }
        return groups, raw_portfolio or _EMPTY_PORTFOLIO
    except (FileNotFoundError, json.JSONDecodeError):
        return {k: list(v) for k, v in _DEFAULT_GROUPS.items()}, _EMPTY_PORTFOLIO


def save_config(group_tickers: dict, portfolio: dict) -> None:
    with _config_lock:
        with open(CONFIG_FILE, "w") as f:
            json.dump(
                {"group_tickers": group_tickers, "portfolio": portfolio},
                f, ensure_ascii=False, indent=2,
            )


# ── Caches ────────────────────────────────────────────────────────────────────
_quotes_cache: TTLCache = TTLCache(maxsize=200, ttl=28)
_premarket_cache: TTLCache = TTLCache(maxsize=200, ttl=60)
_exists_cache: TTLCache = TTLCache(maxsize=1000, ttl=300)
_tw_resolve_cache: TTLCache = TTLCache(maxsize=500, ttl=300)
_cache_lock = threading.Lock()

# ── Quote logging ─────────────────────────────────────────────────────────────
_LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "quote_log.jsonl")
_log_lock = threading.Lock()

def _log_quotes(kind: str, rows: list[dict], cached: bool = False) -> None:
    """Append one JSONL entry with timestamp, kind, and per-ticker snapshot."""
    et = pytz.timezone("America/New_York")
    entry = {
        "ts": datetime.now(et).strftime("%Y-%m-%d %H:%M:%S ET"),
        "kind": kind,        # "quotes" | "premarket"
        "cached": cached,
        "rows": [
            {k: v for k, v in r.items() if k != "volume"}  # skip volume to keep log compact
            for r in rows
        ],
    }
    try:
        with _log_lock:
            with open(_LOG_FILE, "a") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass  # never let logging break the API


# ── Market status ─────────────────────────────────────────────────────────────
def _market_status() -> tuple[str, datetime]:
    et = pytz.timezone("America/New_York")
    now = datetime.now(et)
    if now.weekday() >= 5:
        return "CLOSED", now
    h = now.hour + now.minute / 60
    if 9.5 <= h < 16:
        return "OPEN", now
    if (4 <= h < 9.5) or (16 <= h < 20):
        return "PRE/POST", now
    return "CLOSED", now


# ── Data helpers ──────────────────────────────────────────────────────────────
def _extract_field_series(raw: "pd.DataFrame", ticker: str, field: str) -> "Optional[pd.Series]":
    """Extract any OHLCV field series for one ticker from a yf.download() result."""
    try:
        if isinstance(raw.columns, pd.MultiIndex):
            field_df = raw[field]
            if isinstance(field_df, pd.DataFrame):
                return field_df[ticker] if ticker in field_df.columns else None
            return field_df
        else:
            return raw[field]
    except Exception:
        return None


def _extract_close_series(raw: "pd.DataFrame", ticker: str) -> "Optional[pd.Series]":
    return _extract_field_series(raw, ticker, "Close")


def _single_ticker_quote(ticker: str) -> dict:
    """Download one ticker via yf.Ticker().history() — independent session, no batch pollution."""
    base = {"ticker": ticker, "price": None, "pct": None,
            "day_high": None, "day_low": None, "volume": None}
    try:
        raw = yf.Ticker(ticker).history(period="5d", interval="1d", auto_adjust=True)
        if not raw.empty:
            closes = raw["Close"].dropna()
            if len(closes) >= 2:
                prev, curr = float(closes.iloc[-2]), float(closes.iloc[-1])
                base.update(price=curr, pct=(curr - prev) / prev * 100)
            for field, key in (("High", "day_high"), ("Low", "day_low"), ("Volume", "volume")):
                if field in raw.columns:
                    s = raw[field].dropna()
                    if len(s) >= 1:
                        base[key] = float(s.iloc[-1])
    except Exception:
        pass
    return base


def _fetch_quotes(tickers: tuple) -> list[dict]:
    if not tickers:
        return []
    with _cache_lock:
        if tickers in _quotes_cache:
            cached = _quotes_cache[tickers]
            _log_quotes("quotes", cached, cached=True)
            return cached

    # Fetch each ticker individually (sequential) — yfinance batch downloads are
    # non-deterministic (same batch returns different pct on different calls), and
    # yfinance is not thread-safe so parallel individual downloads also corrupt data.
    out = [_single_ticker_quote(t) for t in tickers]

    if any(r["price"] is not None for r in out):
        with _cache_lock:
            _quotes_cache[tickers] = out
    _log_quotes("quotes", out, cached=False)
    return out


def _fetch_premarket(tickers: tuple) -> list[dict]:
    if not tickers:
        return []
    with _cache_lock:
        if tickers in _premarket_cache:
            cached = _premarket_cache[tickers]
            _log_quotes("premarket", cached, cached=True)
            return cached

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
            dc = _extract_close_series(daily, t)
            if dc is not None:
                dc = dc.dropna()
                if len(dc) >= 2:
                    prev_close = float(dc.iloc[-2])
                elif len(dc) == 1:
                    prev_close = float(dc.iloc[-1])

            mc = _extract_close_series(raw, t)
            if mc is not None:
                mc = mc.dropna()
                if len(mc) >= 1:
                    price = float(mc.iloc[-1])
                    ts = mc.index[-1].astimezone(et).isoformat()
                    if prev_close:
                        pct = (price - prev_close) / prev_close * 100
        except Exception:
            pass
        out.append({"ticker": t, "price": price, "pct": pct,
                    "prev_close": prev_close, "time": ts})

    pm_fresh = False
    try:
        last_date = pd.Timestamp(daily.index[-1]).date()
        today_et = datetime.now(pytz.timezone("America/New_York")).date()
        pm_fresh = (today_et - last_date).days <= 5
    except Exception:
        pm_fresh = True
    if any(r["prev_close"] is not None for r in out) and pm_fresh:
        with _cache_lock:
            _premarket_cache[tickers] = out
    _log_quotes("premarket", out, cached=False)
    return out


def _resolve_tw_ticker(bare: str) -> str:
    with _cache_lock:
        if bare in _tw_resolve_cache:
            return _tw_resolve_cache[bare]
    for suffix in (".TW", ".TWO"):
        try:
            df = yf.download(bare + suffix, period="2d", interval="1d", progress=False)
            if not df.empty:
                result = bare + suffix
                with _cache_lock:
                    _tw_resolve_cache[bare] = result
                return result
        except Exception:
            pass
    result = bare + ".TW"
    with _cache_lock:
        _tw_resolve_cache[bare] = result
    return result


def _ticker_exists(ticker: str) -> bool:
    with _cache_lock:
        if ticker in _exists_cache:
            return _exists_cache[ticker]
    try:
        df = yf.download(ticker, period="5d", interval="1d", progress=False)
        result = not df.empty
    except Exception:
        result = False
    with _cache_lock:
        _exists_cache[ticker] = result
    return result


def _ticker_exists_tw(bare: str) -> bool:
    key = f"tw:{bare}"
    with _cache_lock:
        if key in _exists_cache:
            return _exists_cache[key]
    result = False
    for suffix in (".TW", ".TWO"):
        try:
            df = yf.download(bare + suffix, period="2d", interval="1d", progress=False)
            if not df.empty:
                result = True
                break
        except Exception:
            pass
    with _cache_lock:
        _exists_cache[key] = result
    return result


def _portfolio_rows(account: str) -> list[dict]:
    _, portfolio = load_config()
    acct = portfolio.get(account, {})
    positions = acct.get("positions", {})
    if not positions:
        return []
    is_twd = acct.get("currency") == "TWD"
    if is_twd:
        bare_to_full = {b: _resolve_tw_ticker(b) for b in positions}
        quotes = _fetch_quotes(tuple(bare_to_full.values()))
        full_to_bare = {v: k for k, v in bare_to_full.items()}
        quote_map = {full_to_bare.get(q["ticker"], q["ticker"]): q for q in quotes}
    else:
        quotes = _fetch_quotes(tuple(positions.keys()))
        quote_map = {q["ticker"]: q for q in quotes}

    rows = []
    for ticker, pos in positions.items():
        q = quote_map.get(ticker, {})
        price = q.get("price")
        pct = q.get("pct")
        shares = pos["shares"]
        avg_cost = pos["avg_cost"]
        if price is not None and pct is not None:
            prev_close = price / (1 + pct / 100)
            per_share = price - prev_close
            today_gain = per_share * shares
            unreal_gain = (price - avg_cost) * shares
            unreal_pct = (price - avg_cost) / avg_cost * 100 if avg_cost else 0.0
        else:
            prev_close = per_share = today_gain = unreal_gain = unreal_pct = None
        rows.append({
            "ticker": ticker, "shares": shares, "avg_cost": avg_cost,
            "price": price, "pct": pct, "prev_close": prev_close,
            "per_share": per_share, "today_gain": today_gain,
            "unreal_gain": unreal_gain, "unreal_pct": unreal_pct,
            "day_high": q.get("day_high"), "day_low": q.get("day_low"), "volume": q.get("volume"),
        })
    return rows


def _portfolio_premarket_rows(account: str) -> list[dict]:
    _, portfolio = load_config()
    acct = portfolio.get(account, {})
    positions = acct.get("positions", {})
    if not positions:
        return []
    is_twd = acct.get("currency") == "TWD"
    if is_twd:
        bare_to_full = {b: _resolve_tw_ticker(b) for b in positions}
        pm_quotes = _fetch_premarket(tuple(bare_to_full.values()))
        full_to_bare = {v: k for k, v in bare_to_full.items()}
        pm_map = {full_to_bare.get(q["ticker"], q["ticker"]): q for q in pm_quotes}
    else:
        pm_quotes = _fetch_premarket(tuple(positions.keys()))
        pm_map = {q["ticker"]: q for q in pm_quotes}

    rows = []
    for ticker, pos in positions.items():
        q = pm_map.get(ticker, {})
        close = q.get("prev_close")
        pm_price = q.get("price")
        pm_time = q.get("time")
        shares = pos["shares"]
        if close is not None and pm_price is not None:
            ah_change = pm_price - close
            ah_pct = ah_change / close * 100 if close else 0.0
            ah_gain = ah_change * shares
        else:
            ah_change = ah_pct = ah_gain = None
        rows.append({
            "ticker": ticker, "shares": shares,
            "close": close, "pm_price": pm_price, "pm_time": pm_time,
            "ah_change": ah_change, "ah_pct": ah_pct, "ah_gain": ah_gain,
        })
    return rows


def _strip_tw_suffix(ticker: str) -> str:
    for sfx in (".TW", ".TWO"):
        if ticker.upper().endswith(sfx):
            return ticker[: -len(sfx)]
    return ticker


# ── Routes: system ─────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/market-status")
def market_status():
    status, now = _market_status()
    return {"status": status, "time": now.strftime("%H:%M:%S")}


# ── Routes: market data ────────────────────────────────────────────────────────
@app.get("/api/quotes")
def quotes(tickers: str):
    """Batch day-bar quotes. ?tickers=AAPL,TSLA,TSM"""
    ticker_list = tuple(t.strip().upper() for t in tickers.split(",") if t.strip())
    return _fetch_quotes(ticker_list)


@app.get("/api/premarket")
def premarket(tickers: str):
    """Batch pre/after-market 1-min quotes. ?tickers=AAPL,TSLA"""
    ticker_list = tuple(t.strip().upper() for t in tickers.split(",") if t.strip())
    return _fetch_premarket(ticker_list)


# ── Routes: groups ─────────────────────────────────────────────────────────────
@app.get("/api/groups")
def get_groups():
    groups, _ = load_config()
    return groups


class TickerBody(BaseModel):
    ticker: str


@app.post("/api/groups/{group_name}/tickers")
def add_group_ticker(group_name: str, body: TickerBody):
    ticker = body.ticker.strip().upper()
    if not ticker:
        raise HTTPException(400, "ticker required")
    groups, portfolio = load_config()
    if group_name not in groups:
        raise HTTPException(404, "group not found")
    if ticker not in groups[group_name]:
        groups[group_name].append(ticker)
        save_config(groups, portfolio)
    return {"tickers": groups[group_name]}


@app.delete("/api/groups/{group_name}/tickers/{ticker}")
def remove_group_ticker(group_name: str, ticker: str):
    groups, portfolio = load_config()
    if group_name not in groups:
        raise HTTPException(404, "group not found")
    groups[group_name] = [t for t in groups[group_name] if t != ticker.upper()]
    save_config(groups, portfolio)
    return {"tickers": groups[group_name]}


class OrderBody(BaseModel):
    order: list[str]


@app.put("/api/groups/{group_name}/order")
def reorder_group(group_name: str, body: OrderBody):
    groups, portfolio = load_config()
    if group_name not in groups:
        raise HTTPException(404, "group not found")
    existing = set(groups[group_name])
    new_order = [t for t in body.order if t in existing]
    if set(new_order) != existing:
        raise HTTPException(400, "order must contain exactly the same tickers")
    groups[group_name] = new_order
    save_config(groups, portfolio)
    return {"tickers": groups[group_name]}


# ── Routes: portfolio ──────────────────────────────────────────────────────────
@app.get("/api/portfolio")
def get_portfolio():
    _, portfolio = load_config()
    return portfolio


@app.get("/api/portfolio/{account}/rows")
def get_rows(account: str):
    return _portfolio_rows(account)


@app.get("/api/portfolio/{account}/premarket-rows")
def get_premarket_rows(account: str):
    return _portfolio_premarket_rows(account)


class PositionBody(BaseModel):
    ticker: str
    shares: float
    avg_cost: float


@app.post("/api/portfolio/{account}/positions")
def add_position(account: str, body: PositionBody):
    groups, portfolio = load_config()
    if account not in portfolio:
        raise HTTPException(404, "account not found")
    ticker = body.ticker.strip().upper()
    is_twd = portfolio[account].get("currency") == "TWD"
    if is_twd:
        ticker = _strip_tw_suffix(ticker)
    if ticker in portfolio[account]["positions"]:
        raise HTTPException(409, "ticker already exists; use PUT to update")
    portfolio[account]["positions"][ticker] = {
        "shares": body.shares,
        "avg_cost": body.avg_cost,
    }
    save_config(groups, portfolio)
    return portfolio[account]["positions"][ticker]


@app.put("/api/portfolio/{account}/positions/{ticker}")
def update_position(account: str, ticker: str, body: PositionBody):
    groups, portfolio = load_config()
    if account not in portfolio:
        raise HTTPException(404, "account not found")
    t = ticker.upper()
    if t not in portfolio[account]["positions"]:
        raise HTTPException(404, "position not found")
    portfolio[account]["positions"][t] = {
        "shares": body.shares,
        "avg_cost": body.avg_cost,
    }
    save_config(groups, portfolio)
    return portfolio[account]["positions"][t]


@app.delete("/api/portfolio/{account}/positions/{ticker}")
def delete_position(account: str, ticker: str):
    groups, portfolio = load_config()
    if account not in portfolio:
        raise HTTPException(404, "account not found")
    t = ticker.upper()
    if t not in portfolio[account]["positions"]:
        raise HTTPException(404, "position not found")
    del portfolio[account]["positions"][t]
    save_config(groups, portfolio)
    return {"ok": True}


@app.put("/api/portfolio/{account}/order")
def reorder_portfolio(account: str, body: OrderBody):
    groups, portfolio = load_config()
    if account not in portfolio:
        raise HTTPException(404, "account not found")
    positions = portfolio[account]["positions"]
    existing = set(positions.keys())
    new_order = [t for t in body.order if t in existing]
    if set(new_order) != existing:
        raise HTTPException(400, "order must contain exactly the same tickers")
    portfolio[account]["positions"] = {t: positions[t] for t in new_order}
    save_config(groups, portfolio)
    return {"order": list(portfolio[account]["positions"].keys())}


# ── Routes: validation ─────────────────────────────────────────────────────────
@app.get("/api/validate/us/{ticker}")
def validate_us(ticker: str):
    return {"exists": _ticker_exists(ticker.upper())}


@app.get("/api/validate/tw/{ticker}")
def validate_tw(ticker: str):
    bare = _strip_tw_suffix(ticker.upper())
    exists = _ticker_exists_tw(bare)
    resolved = _resolve_tw_ticker(bare) if exists else None
    return {"exists": exists, "resolved": resolved}
