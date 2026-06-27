"""
Stock Dashboard — FastAPI backend
Shares config.json with the Streamlit app (read/write).
Run: uvicorn main:app --reload --port 8000
"""
import concurrent.futures
import json
import os
import threading
from datetime import datetime
from typing import List, Optional
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
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "user_data.json")
DEMO_FILE   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo_data.json")

_DEFAULT_GROUPS = {
    "⚡ 個股": ["AAOI", "ONDS", "MU", "SNDK", "SPCX", "TSLA", "NVDA", "TSM", "AAPL", "GOOG", "AMZN"],
    "🚀 槓桿型": ["AAOX", "ONDL", "MUU", "SNXX", "TSMX"],
    "🌐 大盤型": ["VOO", "SPY", "QQQ"],
}
_DEFAULT_PINNED = list(_DEFAULT_GROUPS.keys())

# One-time migration: rename groups that used old icons
_ICON_MIGRATION = {"🚀 個股": "⚡ 個股", "⚡ 槓桿型": "🚀 槓桿型"}

_EMPTY_PORTFOLIO = {
    "美股複委託（台幣帳戶）": {"currency": "USD", "positions": {}},
    "美股複委託（美金帳戶）": {"currency": "USD", "positions": {}},
    "台股帳戶":         {"currency": "TWD", "positions": {}},
}


_config_lock = threading.Lock()

TW_NAMES: dict = {
    "0050":  "元大台灣50",
    "0056":  "元大高股息",
    "00878": "國泰永續高股息",
    "00881": "國泰台灣5G+",
    "1101":  "台泥",
    "1216":  "統一",
    "1301":  "台塑",
    "1303":  "南亞",
    "1326":  "台化",
    "2002":  "中鋼",
    "2207":  "和泰車",
    "2303":  "聯電",
    "2308":  "台達電",
    "2317":  "鴻海",
    "2330":  "台積電",
    "2357":  "華碩",
    "2379":  "瑞昱",
    "2382":  "廣達",
    "2395":  "研華",
    "2412":  "中華電",
    "2454":  "聯發科",
    "2609":  "陽明",
    "2615":  "萬海",
    "2880":  "華南金",
    "2881":  "富邦金",
    "2882":  "國泰金",
    "2883":  "開發金",
    "2884":  "玉山金",
    "2885":  "元大金",
    "2886":  "兆豐金",
    "2887":  "台新金",
    "2888":  "新光金",
    "2890":  "永豐金",
    "2891":  "中信金",
    "2892":  "第一金",
    "2912":  "統一超",
    "3008":  "大立光",
    "3034":  "聯詠",
    "3037":  "欣興",
    "3711":  "日月光投控",
    "4904":  "遠傳",
    "4938":  "和碩",
    "5871":  "中租-KY",
    "6415":  "矽力-KY",
    "6505":  "台塑化",
}


# ── Schema migrations ─────────────────────────────────────────────────────────
SCHEMA_VERSION = 3


def _migrate_v1(data: dict) -> dict:
    """Flat portfolio {TICKER: {shares, avg_cost}} → multi-account structure.
    Also handles oldest format where entire file = group_tickers (no wrapper)."""
    if "group_tickers" not in data and "portfolio" not in data:
        data = {"group_tickers": {k: v for k, v in data.items() if isinstance(v, list)}}
    portfolio = data.get("portfolio", {})
    if portfolio:
        first = next(iter(portfolio.values()), {})
        if isinstance(first, dict) and "shares" in first:
            data["portfolio"] = {
                "美股複委託（台幣帳戶）": {"currency": "USD", "positions": portfolio},
                "美股複委託（美金帳戶）": {"currency": "USD", "positions": {}},
                "台股帳戶":         {"currency": "TWD", "positions": {}},
            }
    return data


def _migrate_v2(data: dict) -> dict:
    """Rename group icons: 🚀 個股 → ⚡ 個股, ⚡ 槓桿型 → 🚀 槓桿型."""
    raw = data.get("group_tickers", {})
    pinned = data.get("pinned_groups", [])
    for old, new in _ICON_MIGRATION.items():
        if old in raw and new not in raw:
            raw = {(new if k == old else k): v for k, v in raw.items()}
    data["group_tickers"] = raw
    data["pinned_groups"] = [_ICON_MIGRATION.get(p, p) for p in pinned]
    return data


def _migrate_v3(data: dict) -> dict:
    """Add group_markets field; default all existing groups to 'US'."""
    if "group_markets" not in data:
        data["group_markets"] = {k: "US" for k in data.get("group_tickers", {})}
    return data


_MIGRATIONS: dict = {1: _migrate_v1, 2: _migrate_v2, 3: _migrate_v3}


def run_migrations(data: dict) -> tuple[dict, bool]:
    """Apply all pending migrations in order. Returns (migrated_data, changed)."""
    current = data.get("schema_version", 0)
    if current >= SCHEMA_VERSION:
        return data, False
    for v in range(current + 1, SCHEMA_VERSION + 1):
        if v in _MIGRATIONS:
            data = _MIGRATIONS[v](data)
    data["schema_version"] = SCHEMA_VERSION
    return data, True


def load_config() -> tuple[dict, dict, list, dict]:
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        data, changed = run_migrations(data)
        if changed:
            with _config_lock:
                with open(CONFIG_FILE, "w") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
        raw = data.get("group_tickers", {})
        raw_portfolio = data.get("portfolio", {})
        pinned = data.get("pinned_groups", list(_DEFAULT_PINNED))
        groups: dict = {}
        for k, v in _DEFAULT_GROUPS.items():
            groups[k] = raw.get(k, list(v))
        for k, v in raw.items():
            if k not in groups and isinstance(v, list):
                groups[k] = v
        raw_markets = data.get("group_markets", {})
        markets = {k: raw_markets.get(k, "US") for k in groups}
        return groups, raw_portfolio or _EMPTY_PORTFOLIO, pinned, markets
    except (FileNotFoundError, json.JSONDecodeError):
        return {k: list(v) for k, v in _DEFAULT_GROUPS.items()}, _EMPTY_PORTFOLIO, list(_DEFAULT_PINNED), {k: "US" for k in _DEFAULT_GROUPS}


def save_config(group_tickers: dict, portfolio: dict, pinned: Optional[list] = None, markets: Optional[dict] = None) -> None:
    with _config_lock:
        try:
            with open(CONFIG_FILE, "r") as f:
                existing = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            existing = {}
        existing["group_tickers"] = group_tickers
        existing["portfolio"] = portfolio
        if pinned is not None:
            existing["pinned_groups"] = pinned
        if markets is not None:
            existing["group_markets"] = markets
        with open(CONFIG_FILE, "w") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)


def load_settings() -> dict:
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        return data.get("settings", {"use_mock": False})
    except (FileNotFoundError, json.JSONDecodeError):
        return {"use_mock": False}


def save_settings(settings: dict) -> None:
    with _config_lock:
        try:
            with open(CONFIG_FILE, "r") as f:
                existing = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            existing = {}
        existing["settings"] = settings
        with open(CONFIG_FILE, "w") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)


def active_portfolio() -> dict:
    """Return demo or real portfolio depending on settings."""
    if load_settings().get("use_mock"):
        try:
            with open(DEMO_FILE, "r") as f:
                data = json.load(f)
            return data.get("portfolio", _EMPTY_PORTFOLIO)
        except (FileNotFoundError, json.JSONDecodeError):
            return _EMPTY_PORTFOLIO
    _, portfolio, _, _ = load_config()
    return portfolio


def active_groups() -> dict:
    """Return demo or real group tickers depending on settings."""
    if load_settings().get("use_mock"):
        try:
            with open(DEMO_FILE, "r") as f:
                data = json.load(f)
            return data.get("group_tickers", {k: list(v) for k, v in _DEFAULT_GROUPS.items()})
        except (FileNotFoundError, json.JSONDecodeError):
            return {k: list(v) for k, v in _DEFAULT_GROUPS.items()}
    groups, _, _, _ = load_config()
    return groups


# ── Caches ────────────────────────────────────────────────────────────────────
# Keyed by individual ticker string (not the whole request tuple) so that
# different groups sharing a ticker reuse the same cached entry.
_quotes_cache: TTLCache = TTLCache(maxsize=500, ttl=28)
_premarket_cache: TTLCache = TTLCache(maxsize=500, ttl=60)
_exists_cache: TTLCache = TTLCache(maxsize=1000, ttl=300)
_tw_resolve_cache: TTLCache = TTLCache(maxsize=500, ttl=300)
_cache_lock = threading.Lock()

# ── Quote logging ─────────────────────────────────────────────────────────────
_LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "quote_log.jsonl")
_log_lock = threading.Lock()

def _log_quotes(kind: str, rows: list[dict], n_fetched: int = 0) -> None:
    """Append one JSONL entry with timestamp, kind, cache hit/miss counts."""
    et = pytz.timezone("America/New_York")
    entry = {
        "ts": datetime.now(et).strftime("%Y-%m-%d %H:%M:%S ET"),
        "kind": kind,
        "n_total": len(rows),
        "n_fetched": n_fetched,   # 0 = fully cached; >0 = had fresh fetches
        "rows": [
            {k: v for k, v in r.items() if k != "volume"}
            for r in rows
        ],
    }
    try:
        with _log_lock:
            with open(_LOG_FILE, "a") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


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


def _tw_market_status() -> tuple[str, datetime]:
    taipei = pytz.timezone("Asia/Taipei")
    now = datetime.now(taipei)
    if now.weekday() >= 5:
        return "CLOSED", now
    h = now.hour + now.minute / 60
    if 9 <= h < 13.5:
        return "OPEN", now
    if (8.5 <= h < 9) or (13.5 <= h < 14.5):
        return "PRE/POST", now
    return "CLOSED", now



def _single_ticker_quote(ticker: str) -> dict:
    """Fetch quote via fast_info (real-time endpoint) for price/pct/prev_close,
    and history() for day_high/day_low/volume."""
    base = {"ticker": ticker, "price": None, "pct": None,
            "day_high": None, "day_low": None, "volume": None}
    try:
        t = yf.Ticker(ticker)
        fi = t.fast_info
        price = fi.get("lastPrice") or fi.get("regularMarketPrice")
        prev  = fi.get("regularMarketPreviousClose") or fi.get("previousClose")
        if price and prev:
            base["price"] = float(price)
            base["pct"]   = (float(price) - float(prev)) / float(prev) * 100
        # day_high / day_low / volume from history (fast_info day_high/low can lag)
        raw = t.history(period="2d", interval="1d", auto_adjust=False)
        if not raw.empty:
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

    # Split into cached vs missing using per-ticker cache entries.
    hit: dict[str, dict] = {}
    miss: list[str] = []
    with _cache_lock:
        for t in tickers:
            if t in _quotes_cache:
                hit[t] = _quotes_cache[t]
            else:
                miss.append(t)

    if miss:
        # Each thread creates its own yf.Ticker instance — no shared state.
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            future_map = {ex.submit(_single_ticker_quote, t): t for t in miss}
            for f in concurrent.futures.as_completed(future_map):
                t = future_map[f]
                row = f.result()
                hit[t] = row
                if row.get("price") is not None:
                    with _cache_lock:
                        _quotes_cache[t] = row

    out = [hit.get(t, {"ticker": t, "price": None, "pct": None,
                       "day_high": None, "day_low": None, "volume": None})
           for t in tickers]
    _log_quotes("quotes", out, n_fetched=len(miss))
    return out


def _fetch_premarket(tickers: tuple) -> list[dict]:
    if not tickers:
        return []

    hit: dict[str, dict] = {}
    miss: list[str] = []
    with _cache_lock:
        for t in tickers:
            if t in _premarket_cache:
                hit[t] = _premarket_cache[t]
            else:
                miss.append(t)

    if miss:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            future_map = {ex.submit(_single_ticker_premarket, t): t for t in miss}
            for f in concurrent.futures.as_completed(future_map):
                t = future_map[f]
                row = f.result()
                hit[t] = row
                if row.get("prev_close") is not None:
                    with _cache_lock:
                        _premarket_cache[t] = row

    out = [hit.get(t, {"ticker": t, "price": None, "pct": None,
                       "prev_close": None, "time": None})
           for t in tickers]
    _log_quotes("premarket", out, n_fetched=len(miss))
    return out


def _single_ticker_premarket(ticker: str) -> dict:
    """Fetch pre/after-hours price + prev close via independent Ticker instances."""
    et = pytz.timezone("America/New_York")
    base = {"ticker": ticker, "price": None, "pct": None, "prev_close": None, "time": None}
    try:
        daily = yf.Ticker(ticker).history(period="5d", interval="1d", auto_adjust=False)
        if not daily.empty:
            closes = daily["Close"].dropna()
            if len(closes) >= 2:
                base["prev_close"] = float(closes.iloc[-2])
            elif len(closes) == 1:
                base["prev_close"] = float(closes.iloc[-1])

        intraday = yf.Ticker(ticker).history(period="1d", interval="1m",
                                              prepost=True, auto_adjust=False)
        if not intraday.empty:
            mc = intraday["Close"].dropna()
            if len(mc) >= 1:
                base["price"] = float(mc.iloc[-1])
                base["time"] = mc.index[-1].astimezone(et).isoformat()
                if base["prev_close"]:
                    base["pct"] = (base["price"] - base["prev_close"]) / base["prev_close"] * 100
    except Exception:
        pass
    return base


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
    portfolio = active_portfolio()
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
        total_cost = pos.get("total_cost")
        if price is not None and pct is not None:
            prev_close = price / (1 + pct / 100)
            per_share = price - prev_close
            today_gain = per_share * shares
            cost_basis = total_cost if total_cost is not None else avg_cost * shares
            unreal_gain = price * shares - cost_basis
            unreal_pct = unreal_gain / cost_basis * 100 if cost_basis else 0.0
        else:
            prev_close = per_share = today_gain = unreal_gain = unreal_pct = None
        cost_basis = (total_cost if total_cost is not None else avg_cost * shares)
        rows.append({
            "ticker": ticker, "name": TW_NAMES.get(ticker, "") if is_twd else "",
            "shares": shares, "avg_cost": avg_cost,
            "price": price, "pct": pct, "prev_close": prev_close,
            "per_share": per_share, "today_gain": today_gain,
            "unreal_gain": unreal_gain, "unreal_pct": unreal_pct,
            "cost_basis": cost_basis,
            "day_high": q.get("day_high"), "day_low": q.get("day_low"), "volume": q.get("volume"),
        })
    return rows


def _portfolio_premarket_rows(account: str) -> list[dict]:
    portfolio = active_portfolio()
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


class SettingsBody(BaseModel):
    use_mock:  Optional[bool] = None
    col_vis:   Optional[list] = None   # legacy flat; kept for migration reads
    col_order: Optional[list] = None   # legacy flat; kept for migration reads
    pnl_cols:  Optional[dict] = None   # { account_key: { vis: [...], order: [...] } }


@app.get("/api/settings")
def get_settings():
    return load_settings()


@app.put("/api/settings")
def put_settings(body: SettingsBody):
    s = load_settings()
    if body.use_mock is not None:
        s["use_mock"] = body.use_mock
    if body.col_vis is not None:
        s["col_vis"] = body.col_vis
    if body.col_order is not None:
        s["col_order"] = body.col_order
    if body.pnl_cols is not None:
        existing = s.get("pnl_cols", {})
        existing.update(body.pnl_cols)
        s["pnl_cols"] = existing
    save_settings(s)
    return s


@app.get("/api/market-status")
def market_status():
    us_status, us_now = _market_status()
    tw_status, tw_now = _tw_market_status()
    return {
        "status": us_status,
        "time": us_now.strftime("%H:%M:%S"),
        "us": {"status": us_status, "time": us_now.strftime("%H:%M:%S")},
        "tw": {"status": tw_status, "time": tw_now.strftime("%H:%M:%S")},
    }


# ── Routes: market data ────────────────────────────────────────────────────────
@app.get("/api/quotes")
def quotes(tickers: str, market: str = "US"):
    """Batch day-bar quotes. ?tickers=AAPL,TSLA or ?tickers=2330,2317&market=TW"""
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return []
    if market == "TW":
        resolved = [_resolve_tw_ticker(t) for t in ticker_list]
        raw_rows = _fetch_quotes(tuple(resolved))
        resolved_to_bare = dict(zip(resolved, ticker_list))
        return [{**{k: v for k, v in r.items() if k != "ticker"}, "ticker": resolved_to_bare.get(r["ticker"], r["ticker"])} for r in raw_rows]
    return _fetch_quotes(tuple(ticker_list))


@app.get("/api/premarket")
def premarket(tickers: str):
    """Batch pre/after-market 1-min quotes. ?tickers=AAPL,TSLA"""
    ticker_list = tuple(t.strip().upper() for t in tickers.split(",") if t.strip())
    return _fetch_premarket(ticker_list)


# ── Routes: groups ─────────────────────────────────────────────────────────────
def _groups_response(groups: dict, pinned: list, markets: dict) -> dict:
    return {"groups": groups, "pinned": pinned, "markets": markets}


@app.get("/api/groups")
def get_groups():
    if load_settings().get("use_mock"):
        try:
            with open(DEMO_FILE, "r") as f:
                data = json.load(f)
            grps = data.get("group_tickers", {k: list(v) for k, v in _DEFAULT_GROUPS.items()})
            mkts = data.get("group_markets", {g: "US" for g in grps})
        except (FileNotFoundError, json.JSONDecodeError):
            grps = {k: list(v) for k, v in _DEFAULT_GROUPS.items()}
            mkts = {k: "US" for k in grps}
        return _groups_response(grps, list(_DEFAULT_PINNED), mkts)
    groups, _, pinned, markets = load_config()
    return _groups_response(groups, pinned, markets)


def _require_real_mode() -> None:
    if load_settings().get("use_mock"):
        raise HTTPException(403, "read-only in demo mode")


class GroupBody(BaseModel):
    name: str
    market: str = "US"


class OrderBody(BaseModel):
    order: List[str]


@app.put("/api/groups/order")
def reorder_groups(body: OrderBody):
    _require_real_mode()
    groups, portfolio, pinned, markets = load_config()
    specified = [n for n in body.order if n in groups]
    new_groups = {n: groups[n] for n in specified}
    for n, tickers in groups.items():
        if n not in new_groups:
            new_groups[n] = tickers
    save_config(new_groups, portfolio, pinned, markets=markets)
    return _groups_response(new_groups, pinned, markets)


@app.post("/api/groups")
def create_group(body: GroupBody):
    _require_real_mode()
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name required")
    market = body.market if body.market in ("US", "TW") else "US"
    groups, portfolio, pinned, markets = load_config()
    if name in groups:
        raise HTTPException(409, "group already exists")
    groups[name] = []
    markets[name] = market
    save_config(groups, portfolio, markets=markets)
    return _groups_response(groups, pinned, markets)


@app.delete("/api/groups/{group_name}")
def delete_group(group_name: str):
    _require_real_mode()
    groups, portfolio, pinned, markets = load_config()
    if group_name not in groups:
        raise HTTPException(404, "group not found")
    if group_name in pinned:
        raise HTTPException(403, "cannot delete a pinned group")
    del groups[group_name]
    markets.pop(group_name, None)
    save_config(groups, portfolio, markets=markets)
    return _groups_response(groups, pinned, markets)


@app.patch("/api/groups/{group_name}")
def rename_group(group_name: str, body: GroupBody):
    _require_real_mode()
    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(400, "name required")
    groups, portfolio, pinned, markets = load_config()
    if group_name not in groups:
        raise HTTPException(404, "group not found")
    if new_name != group_name and new_name in groups:
        raise HTTPException(409, "group already exists")
    groups = {(new_name if k == group_name else k): v for k, v in groups.items()}
    new_pinned = [(new_name if p == group_name else p) for p in pinned]
    markets = {(new_name if k == group_name else k): v for k, v in markets.items()}
    save_config(groups, portfolio, new_pinned, markets=markets)
    return _groups_response(groups, new_pinned, markets)


class TickerBody(BaseModel):
    ticker: str


@app.post("/api/groups/{group_name}/tickers")
def add_group_ticker(group_name: str, body: TickerBody):
    _require_real_mode()
    ticker = body.ticker.strip().upper()
    if not ticker:
        raise HTTPException(400, "ticker required")
    groups, portfolio, _, _ = load_config()
    if group_name not in groups:
        raise HTTPException(404, "group not found")
    if ticker not in groups[group_name]:
        groups[group_name].append(ticker)
        save_config(groups, portfolio)
    return {"tickers": groups[group_name]}


@app.delete("/api/groups/{group_name}/tickers/{ticker}")
def remove_group_ticker(group_name: str, ticker: str):
    _require_real_mode()
    groups, portfolio, _, _ = load_config()
    if group_name not in groups:
        raise HTTPException(404, "group not found")
    groups[group_name] = [t for t in groups[group_name] if t != ticker.upper()]
    save_config(groups, portfolio)
    return {"tickers": groups[group_name]}


@app.put("/api/groups/{group_name}/order")
def reorder_group(group_name: str, body: OrderBody):
    _require_real_mode()
    groups, portfolio, _, _ = load_config()
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
    portfolio = active_portfolio()
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
    total_cost: Optional[float] = None


def _build_position(shares: float, avg_cost: float, total_cost: Optional[float]) -> dict:
    pos: dict = {"shares": shares, "avg_cost": avg_cost}
    if total_cost is not None:
        pos["total_cost"] = total_cost
        pos["avg_cost"] = total_cost / shares  # keep avg_cost in sync at full precision
    return pos


@app.post("/api/portfolio/{account}/positions")
def add_position(account: str, body: PositionBody):
    _require_real_mode()
    groups, portfolio, _, _ = load_config()
    if account not in portfolio:
        raise HTTPException(404, "account not found")
    ticker = body.ticker.strip().upper()
    is_twd = portfolio[account].get("currency") == "TWD"
    if is_twd:
        ticker = _strip_tw_suffix(ticker)
    if ticker in portfolio[account]["positions"]:
        raise HTTPException(409, "ticker already exists; use PUT to update")
    portfolio[account]["positions"][ticker] = _build_position(body.shares, body.avg_cost, body.total_cost)
    save_config(groups, portfolio)
    return portfolio[account]["positions"][ticker]


@app.put("/api/portfolio/{account}/positions/{ticker}")
def update_position(account: str, ticker: str, body: PositionBody):
    _require_real_mode()
    groups, portfolio, _, _ = load_config()
    if account not in portfolio:
        raise HTTPException(404, "account not found")
    t = ticker.upper()
    if t not in portfolio[account]["positions"]:
        raise HTTPException(404, "position not found")
    portfolio[account]["positions"][t] = _build_position(body.shares, body.avg_cost, body.total_cost)
    save_config(groups, portfolio)
    return portfolio[account]["positions"][t]


@app.delete("/api/portfolio/{account}/positions/{ticker}")
def delete_position(account: str, ticker: str):
    _require_real_mode()
    groups, portfolio, _, _ = load_config()
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
    _require_real_mode()
    groups, portfolio, _, _ = load_config()
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
