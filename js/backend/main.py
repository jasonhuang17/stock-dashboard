"""
Stock Dashboard — FastAPI backend
Run: cd app/backend && uvicorn main:app --reload --port 8000
"""
import concurrent.futures
import json
import os
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from contextvars import ContextVar
from datetime import datetime, time as dtime, timedelta
from typing import List, Optional
import pytz
import yfinance as yf
from cachetools import TTLCache
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from tw_names import TW_NAMES
from tw_exchange import TW_EXCHANGE

app = FastAPI(title="Stock Dashboard API", version="1.0.0")

def _cors_origins() -> list[str]:
    origins = ["http://localhost:3000", "http://localhost:3001"]
    extra = os.environ.get("CORS_ORIGINS", "")
    for origin in extra.split(","):
        origin = origin.strip().rstrip("/")
        if origin and origin not in origins:
            origins.append(origin)
    return origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|100\.\d+\.\d+\.\d+):3000$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_ACCESS_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "access_log.jsonl")

def _client_host(request: Request) -> Optional[str]:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else None

def _log_access(request: Request, status_code: int, elapsed_ms: float) -> None:
    entry = {
        "ts": datetime.now().isoformat(timespec="seconds"),
        "client": _client_host(request),
        "method": request.method,
        "path": request.url.path,
        "query": request.url.query,
        "status": status_code,
        "elapsed_ms": round(elapsed_ms, 1),
        "origin": request.headers.get("origin"),
        "referer": request.headers.get("referer"),
        "user_agent": request.headers.get("user-agent"),
    }
    try:
        with _log_lock:
            with open(_ACCESS_LOG, "a") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass

# ── Multi-user: IP → username mapping ────────────────────────────────────────
_USERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "users.json")

def _load_users() -> dict:
    try:
        with open(_USERS_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

_USERS: dict = _load_users()
_current_user: ContextVar[str] = ContextVar("current_user", default="default")

@app.middleware("http")
async def access_log_middleware(request: Request, call_next):
    started = time.perf_counter()
    ip = _client_host(request)
    username = _USERS.get(ip or "", "default")
    token = _current_user.set(username)
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        _current_user.reset(token)
        _log_access(request, status_code, (time.perf_counter() - started) * 1000)

# ── Config ────────────────────────────────────────────────────────────────────
_DATA_DIR   = os.path.dirname(os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "user_data.json")))
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "user_data.json")
DEMO_FILE   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo_data.json")

def _user_config_file() -> str:
    """Return the per-user data file path based on the current request context."""
    username = _current_user.get()
    if username == "default":
        return CONFIG_FILE
    return os.path.join(os.path.dirname(CONFIG_FILE), f"user_data_{username}.json")

# Per-user file locks — prevents concurrent writes within one user's session.
_config_locks: dict = {}
_config_locks_meta = threading.Lock()

def _get_config_lock() -> threading.Lock:
    username = _current_user.get()
    with _config_locks_meta:
        if username not in _config_locks:
            _config_locks[username] = threading.Lock()
        return _config_locks[username]

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

_SETTINGS_LOG = os.path.join(os.path.dirname(__file__), "user_data_log.jsonl")

def _log_settings_change(before: dict, after: dict) -> None:
    """Append a diff entry to user_data_log.jsonl whenever settings change."""
    def _pnl_summary(s: dict) -> dict:
        pc = s.get("pnl_cols", {})
        return {k: {"vis": v.get("vis", []), "dividers": v.get("dividers", [])} for k, v in pc.items()}

    before_pnl = _pnl_summary(before)
    after_pnl  = _pnl_summary(after)
    before_grp = before.get("account_groups", [])
    after_grp  = after.get("account_groups", [])

    added   = [k for k in after_pnl  if k not in before_pnl]
    removed = [k for k in before_pnl if k not in after_pnl]
    changed = [k for k in after_pnl  if k in before_pnl and after_pnl[k] != before_pnl[k]]

    if not added and not removed and not changed and before_grp == after_grp:
        return  # nothing meaningful changed

    entry = {
        "ts": datetime.now().isoformat(timespec="seconds"),
        "pnl_cols": {
            "before_keys": sorted(before_pnl.keys()),
            "after_keys":  sorted(after_pnl.keys()),
            "added":   added,
            "removed": removed,
            "changed": changed,
        },
    }
    if before_grp != after_grp:
        entry["account_groups"] = {"before": before_grp, "after": after_grp}

    try:
        with open(_SETTINGS_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


# ── Schema migrations ─────────────────────────────────────────────────────────
# Bump SCHEMA_VERSION and add _migrate_vN whenever user_data.json format changes.
# See CLAUDE.md "資料格式版本管理" for the protocol.
#
# v1 — app v1 baseline (origin/master): consolidates all pre-versioning legacy formats
# v2 — app v2: added group_markets per-group market designation
# v3 — app v3: added crypto_tickers to settings (custom crypto watchlist)
# v4 — app v4: added account_groups to settings (user-defined portfolio grouping)
SCHEMA_VERSION = 4


def _migrate_v1(data: dict) -> dict:
    """Bring any legacy format up to the app-v1 baseline.

    Covers three historical formats in one pass:
    1. Bare file (entire JSON = group_tickers dict, no wrapper)
    2. Flat portfolio {TICKER: {shares, avg_cost}} → multi-account structure
    3. Icon rename: 🚀 個股 → ⚡ 個股, ⚡ 槓桿型 → 🚀 槓桿型
    """
    # 1. Bare file
    if "group_tickers" not in data and "portfolio" not in data:
        data = {"group_tickers": {k: v for k, v in data.items() if isinstance(v, list)}}
    # 2. Flat portfolio
    portfolio = data.get("portfolio", {})
    if portfolio:
        first = next(iter(portfolio.values()), {})
        if isinstance(first, dict) and "shares" in first:
            data["portfolio"] = {
                "美股複委託（台幣帳戶）": {"currency": "USD", "positions": portfolio},
                "美股複委託（美金帳戶）": {"currency": "USD", "positions": {}},
                "台股帳戶":         {"currency": "TWD", "positions": {}},
            }
    # 3. Icon rename
    raw = data.get("group_tickers", {})
    pinned = data.get("pinned_groups", [])
    for old, new in _ICON_MIGRATION.items():
        if old in raw and new not in raw:
            raw = {(new if k == old else k): v for k, v in raw.items()}
    data["group_tickers"] = raw
    data["pinned_groups"] = [_ICON_MIGRATION.get(p, p) for p in pinned]
    return data


def _migrate_v2(data: dict) -> dict:
    """App v2: add group_markets field, default all existing groups to 'US'."""
    if "group_markets" not in data:
        data["group_markets"] = {k: "US" for k in data.get("group_tickers", {})}
    return data


def _migrate_v3(data: dict) -> dict:
    """App v3: add crypto_tickers to settings with the 15 built-in defaults."""
    s = data.setdefault("settings", {})
    if "crypto_tickers" not in s:
        s["crypto_tickers"] = [
            "BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "XRP-USD",
            "ADA-USD", "AVAX-USD", "DOGE-USD", "DOT-USD", "LINK-USD",
            "MATIC-USD", "UNI-USD", "LTC-USD", "ATOM-USD", "FIL-USD",
        ]
    return data


def _migrate_v4(data: dict) -> dict:
    """App v4: add account_groups to settings (user-defined portfolio grouping)."""
    s = data.setdefault("settings", {})
    if "account_groups" not in s:
        s["account_groups"] = []
    return data


_MIGRATIONS: dict = {1: _migrate_v1, 2: _migrate_v2, 3: _migrate_v3, 4: _migrate_v4}


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
    cf = _user_config_file()
    try:
        with open(cf, "r") as f:
            data = json.load(f)
        data, changed = run_migrations(data)
        if changed:
            with _get_config_lock():
                with open(cf, "w") as f:
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
    cf = _user_config_file()
    with _get_config_lock():
        try:
            with open(cf, "r") as f:
                existing = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            existing = {}
        existing["group_tickers"] = group_tickers
        existing["portfolio"] = portfolio
        if pinned is not None:
            existing["pinned_groups"] = pinned
        if markets is not None:
            existing["group_markets"] = markets
        with open(cf, "w") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)


def load_settings() -> dict:
    try:
        with open(_user_config_file(), "r") as f:
            data = json.load(f)
        s = data.get("settings", {})
    except (FileNotFoundError, json.JSONDecodeError):
        s = {}
    s.setdefault("use_mock", False)
    s.setdefault("theme", "dark-cyber")
    s.setdefault("crypto_sort", {"col": "pct", "dir": "desc"})
    s.setdefault("group_sorts", {})
    s.setdefault("crypto_tickers", list(_DEFAULT_CRYPTO))
    s.setdefault("account_groups", [])
    return s


def save_settings(settings: dict) -> None:
    cf = _user_config_file()
    with _get_config_lock():
        try:
            with open(cf, "r") as f:
                existing = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            existing = {}
        existing["settings"] = settings
        with open(cf, "w") as f:
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
_quotes_stale: dict = {}   # last known-good quote per ticker; no expiry — fallback when fresh fetch fails
_premarket_cache: TTLCache = TTLCache(maxsize=500, ttl=60)
_exists_cache: TTLCache = TTLCache(maxsize=1000, ttl=300)
_tw_resolve_cache: TTLCache = TTLCache(maxsize=500, ttl=3600)
_tw_name_cache: dict = {}  # permanent — ticker names don't change
_ytd_cache: TTLCache = TTLCache(maxsize=500, ttl=86400)   # 24h — year-start price
_52w_cache: TTLCache = TTLCache(maxsize=500, ttl=3600)    # 1h — 52-week high/low (background-populated)
_portfolio_rows_cache: TTLCache = TTLCache(maxsize=100, ttl=30)
_portfolio_rows_inflight: dict[str, threading.Event] = {}
_cache_lock = threading.Lock()
# Limits concurrent yf.download calls to 1 to prevent Yahoo Finance rate-limiting
# when all portfolio accounts load simultaneously on fresh backend start.
_yf_semaphore = threading.Semaphore(1)

# ── Quote / portfolio logging ──────────────────────────────────────────────────
_LOG_FILE       = os.path.join(os.path.dirname(os.path.abspath(__file__)), "quote_log.jsonl")
_PORTFOLIO_LOG  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "portfolio_log.jsonl")
_log_lock = threading.Lock()

def _log_portfolio(account: str, currency: str, rows: list,
                   tw_resolved=None, stale_tickers=None) -> None:
    """Append one entry to portfolio_log.jsonl recording which fields were null and why."""
    et = pytz.timezone("America/New_York")
    null_price  = [r["ticker"] for r in rows if r.get("price")     is None]
    null_ytd    = [r["ticker"] for r in rows if r.get("ytd_gain")  is None]
    null_52w    = [r["ticker"] for r in rows if r.get("week_high") is None]
    entry = {
        "ts":            datetime.now(et).strftime("%Y-%m-%d %H:%M:%S ET"),
        "account":       account,
        "currency":      currency,
        "tickers":       [r["ticker"] for r in rows],
        "null_price":    null_price,
        "stale_used":    stale_tickers or [],
        "null_ytd":      null_ytd,
        "null_52w":      null_52w,
    }
    if tw_resolved:
        entry["tw_resolved"] = tw_resolved
    try:
        with _log_lock:
            with open(_PORTFOLIO_LOG, "a") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


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


def _portfolio_rows_cache_key(account: str) -> str:
    settings = load_settings()
    portfolio = active_portfolio()
    acct = portfolio.get(account, {})
    signature = json.dumps({
        "mock": bool(settings.get("use_mock")),
        "currency": acct.get("currency"),
        "positions": acct.get("positions", {}),
    }, ensure_ascii=False, sort_keys=True)
    return f"{account}:{signature}"


def _cached_portfolio_rows(account: str) -> list[dict]:
    cache_key = _portfolio_rows_cache_key(account)
    should_compute = False
    with _cache_lock:
        cached = _portfolio_rows_cache.get(cache_key)
        if cached is not None:
            return cached
        event = _portfolio_rows_inflight.get(cache_key)
        if event is None:
            event = threading.Event()
            _portfolio_rows_inflight[cache_key] = event
            should_compute = True

    if not should_compute:
        event.wait(timeout=90)
        with _cache_lock:
            cached = _portfolio_rows_cache.get(cache_key)
            if cached is not None:
                return cached
        return []

    try:
        rows = _portfolio_rows(account)
        with _cache_lock:
            _portfolio_rows_cache[cache_key] = rows
        return rows
    finally:
        with _cache_lock:
            done = _portfolio_rows_inflight.pop(cache_key, None)
            if done:
                done.set()


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



def _fetch_52w_batch(tickers: list) -> None:
    """Background batch-fetch 52W high/low via yf.download(period='1y').
    Populates _52w_cache in place; called from a daemon thread in _fetch_quotes."""
    if not tickers:
        return
    try:
        dl_arg = tickers[0] if len(tickers) == 1 else tickers
        df = None
        for attempt in range(2):
            try:
                with _yf_semaphore:
                    df = yf.download(dl_arg, period="1y", interval="1d", progress=False, auto_adjust=False)
                break
            except sqlite3.OperationalError:
                if attempt == 0:
                    time.sleep(0.5)
        if df is None or df.empty:
            return
        is_multi = hasattr(df.columns, "levels")
        for t in tickers:
            try:
                highs = df["High"][t].dropna() if is_multi else df["High"].dropna()
                lows  = df["Low"][t].dropna()  if is_multi else df["Low"].dropna()
                if len(highs) and len(lows):
                    with _cache_lock:
                        _52w_cache[t] = {"week_high": float(highs.max()), "week_low": float(lows.min())}
            except Exception:
                pass
    except Exception:
        pass


def _fetch_ytd_batch(tickers: list) -> dict:
    """Batch-fetch YTD start prices via yf.download.
    Pass 1: Jan 1-20 date range (stocks that existed at year start).
    Pass 2: period='ytd' for any still missing (covers tickers that IPO'd after Jan 20).
    Only caches successes — failures retry next portfolio load."""
    if not tickers:
        return {}
    result: dict = {}
    miss: list = []
    with _cache_lock:
        for t in tickers:
            if t in _ytd_cache:
                result[t] = _ytd_cache[t]
            else:
                miss.append(t)
    if not miss:
        return result
    year = datetime.now().year
    # Pass 1: batch download Jan 1-20 (covers most stocks)
    remaining = [t for t in miss if t not in result]
    if remaining:
        try:
            dl_arg = remaining[0] if len(remaining) == 1 else remaining
            df = None
            for attempt in range(2):
                try:
                    with _yf_semaphore:
                        df = yf.download(dl_arg, start=f"{year}-01-01", end=f"{year}-01-20",
                                         progress=False, auto_adjust=False)
                    break
                except sqlite3.OperationalError:
                    if attempt == 0:
                        time.sleep(0.5)
            if df is not None and not df.empty:
                is_multi = hasattr(df.columns, "levels")
                for t in remaining:
                    try:
                        series = df["Close"][t].dropna() if is_multi else df["Close"].dropna()
                        if len(series):
                            val = float(series.iloc[0])
                            result[t] = val
                            with _cache_lock:
                                _ytd_cache[t] = val
                    except Exception:
                        pass
        except Exception:
            pass

    # Pass 2: per-ticker ytd fetch for anything still missing (newly listed or special tickers).
    # Done individually so one bad ticker (e.g. delisted warrants) cannot fail the whole batch.
    for t in [t for t in miss if t not in result]:
        try:
            with _yf_semaphore:
                df = yf.download(t, period="ytd", interval="1d", progress=False, auto_adjust=False)
            if df is not None and not df.empty:
                series = df["Close"].dropna()
                if len(series):
                    val = float(series.iloc[0])
                    result[t] = val
                    with _cache_lock:
                        _ytd_cache[t] = val
        except Exception:
            pass
    for t in miss:
        if t not in result:
            result[t] = None   # not cached — retried on next load
    return result


def _fetch_quotes(tickers: tuple) -> list[dict]:
    """Batch-fetch quotes via a single yf.download call.
    One HTTP request for all cache misses eliminates the per-ticker concurrent requests
    that previously triggered Yahoo Finance rate limits and caused intermittent null data.
    Falls back to _quotes_stale (last known-good, no expiry) when a fresh fetch fails."""
    if not tickers:
        return []

    hit: dict[str, dict] = {}
    miss: list[str] = []
    miss_52w: list[str] = []
    with _cache_lock:
        for t in tickers:
            if t in _quotes_cache:
                hit[t] = _quotes_cache[t]
            else:
                miss.append(t)
            if t not in _52w_cache:
                miss_52w.append(t)

    if miss:
        _empty = lambda t: {"ticker": t, "price": None, "pct": None,
                            "day_high": None, "day_low": None, "volume": None,
                            "week_high": None, "week_low": None}
        try:
            dl_arg = miss[0] if len(miss) == 1 else miss
            df = None
            for attempt in range(2):
                try:
                    with _yf_semaphore:
                        df = yf.download(dl_arg, period="5d", interval="1d", progress=False, auto_adjust=False)
                    break
                except sqlite3.OperationalError:
                    if attempt == 0:
                        time.sleep(0.5)
            if df is None:
                raise RuntimeError("yf.download failed after retry")
            is_multi = (not df.empty) and hasattr(df.columns, "levels")
            for t in miss:
                row = _empty(t)
                if not df.empty:
                    try:
                        if is_multi:
                            closes = df["Close"][t].dropna()
                            highs  = df["High"][t].dropna()
                            lows   = df["Low"][t].dropna()
                            vols   = df["Volume"][t].dropna()
                        else:
                            closes = df["Close"].dropna()
                            highs  = df["High"].dropna()
                            lows   = df["Low"].dropna()
                            vols   = df["Volume"].dropna()
                        if len(closes) >= 2:
                            row["price"] = float(closes.iloc[-1])
                            row["pct"] = (float(closes.iloc[-1]) - float(closes.iloc[-2])) / float(closes.iloc[-2]) * 100
                        elif len(closes) == 1:
                            row["price"] = float(closes.iloc[-1])
                            # Fallback: try fast_info for prev close (sparse tickers like warrants)
                            try:
                                pc = yf.Ticker(t).fast_info.get("previousClose") or yf.Ticker(t).fast_info.get("regularMarketPreviousClose")
                                if pc:
                                    row["pct"] = (row["price"] - float(pc)) / float(pc) * 100
                            except Exception:
                                pass
                        if len(highs) >= 1: row["day_high"] = float(highs.iloc[-1])
                        if len(lows)  >= 1: row["day_low"]  = float(lows.iloc[-1])
                        if len(vols)  >= 1: row["volume"]   = float(vols.iloc[-1])
                    except Exception:
                        pass
                # Merge 52W from background cache (populated by _fetch_52w_batch daemon thread)
                with _cache_lock:
                    w = _52w_cache.get(t)
                if w:
                    row["week_high"] = w.get("week_high")
                    row["week_low"]  = w.get("week_low")
                if row.get("price") is not None:
                    row["fetched_at"] = datetime.now().timestamp()
                    with _cache_lock:
                        _quotes_cache[t] = row
                        _quotes_stale[t] = row
                    hit[t] = row
                elif t in _quotes_stale:
                    hit[t] = _quotes_stale[t]   # serve last known-good on fetch failure
                else:
                    hit[t] = row                 # genuinely first time and failed — show null
        except Exception:
            for t in miss:
                hit[t] = _quotes_stale[t] if t in _quotes_stale else \
                          {"ticker": t, "price": None, "pct": None,
                           "day_high": None, "day_low": None, "volume": None,
                           "week_high": None, "week_low": None}

    # Kick off background 52W H/L refresh for tickers not yet in _52w_cache
    if miss_52w:
        threading.Thread(target=_fetch_52w_batch, args=(miss_52w,), daemon=True).start()

    out = [hit.get(t, _quotes_stale.get(t) or {"ticker": t, "price": None, "pct": None,
                                                "day_high": None, "day_low": None, "volume": None,
                                                "week_high": None, "week_low": None})
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
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
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
            if len(closes) >= 1:
                # Determine whether today's regular session has already completed.
                # yfinance daily index is timezone-aware; compare date in ET.
                try:
                    last_idx = daily.index[-1]
                    last_date = last_idx.tz_convert(et).date() if hasattr(last_idx, "tz_convert") else last_idx.date()
                except Exception:
                    last_date = None
                today_et = datetime.now(et).date()
                if last_date == today_et and len(closes) >= 2:
                    # Regular session completed today: second-to-last bar = yesterday's close
                    base["prev_close"] = float(closes.iloc[-2])
                else:
                    # Pre-market or weekend: last bar IS yesterday's (most recent) close
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


def _fetch_tw_name(bare: str, resolved: str) -> str:
    """Return Chinese/display name for a TW ticker. TW_NAMES first, then yfinance info (cached)."""
    if bare in TW_NAMES:
        return TW_NAMES[bare]
    with _cache_lock:
        if bare in _tw_name_cache:
            return _tw_name_cache[bare]
    try:
        info = yf.Ticker(resolved).info
        name = (info.get("shortName") or info.get("longName") or "").strip()
    except Exception:
        name = ""
    with _cache_lock:
        _tw_name_cache[bare] = name
    return name


def _resolve_tw_ticker(bare: str) -> str:
    # Fast path: static exchange lookup (covers 2340 listed/OTC stocks)
    if bare in TW_EXCHANGE:
        return bare + TW_EXCHANGE[bare]
    # Fallback for unlisted/new codes: try download (cached to avoid repeat hits)
    with _cache_lock:
        if bare in _tw_resolve_cache:
            return _tw_resolve_cache[bare]
    for suffix in (".TW", ".TWO"):
        try:
            df = yf.download(bare + suffix, period="5d", interval="1d", progress=False)
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
    # If it's in our static exchange table, we know it's valid
    if bare in TW_EXCHANGE:
        return True
    key = f"tw:{bare}"
    with _cache_lock:
        if key in _exists_cache:
            return _exists_cache[key]
    result = False
    for suffix in (".TW", ".TWO"):
        try:
            df = yf.download(bare + suffix, period="5d", interval="1d", progress=False)
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

    # Fetch YTD start prices: one batch yf.download call instead of N concurrent requests
    ytd_full_tickers = list(bare_to_full.values()) if is_twd else list(positions.keys())
    ytd_full_map = _fetch_ytd_batch(ytd_full_tickers)
    if is_twd:
        ytd_map: dict = {full_to_bare.get(full, full): val for full, val in ytd_full_map.items()}
    else:
        ytd_map = ytd_full_map

    # Track which tickers came from stale cache (price present but not in live cache)
    with _cache_lock:
        live_cached = set(_quotes_cache.keys())
    stale_tickers = []

    rows = []
    for ticker, pos in positions.items():
        q = quote_map.get(ticker, {})
        price = q.get("price")
        pct = q.get("pct")
        # Determine the resolved ticker key for cache check
        resolved_key = bare_to_full.get(ticker, ticker) if is_twd else ticker
        if price is not None and resolved_key not in live_cached:
            stale_tickers.append(ticker)
        shares = pos["shares"]
        avg_cost = pos["avg_cost"]
        total_cost = pos.get("total_cost")
        cost_basis = total_cost if total_cost is not None else avg_cost * shares
        if price is not None and pct is not None:
            prev_close = price / (1 + pct / 100)
            per_share = price - prev_close
            today_gain = per_share * shares
        else:
            prev_close = per_share = today_gain = None
        if price is not None:
            unreal_gain = price * shares - cost_basis
            unreal_pct = unreal_gain / cost_basis * 100 if cost_basis else 0.0
        else:
            unreal_gain = unreal_pct = None
        ytd_start = ytd_map.get(ticker)
        if price is not None and ytd_start is not None and ytd_start > 0:
            ytd_gain = (price - ytd_start) * shares
            ytd_pct = (price - ytd_start) / ytd_start * 100
        else:
            ytd_gain = ytd_pct = None
        rows.append({
            "ticker": ticker, "name": TW_NAMES.get(ticker, "") if is_twd else "",
            "shares": shares, "avg_cost": avg_cost,
            "price": price, "pct": pct, "prev_close": prev_close,
            "per_share": per_share, "today_gain": today_gain,
            "unreal_gain": unreal_gain, "unreal_pct": unreal_pct,
            "cost_basis": cost_basis,
            "day_high": q.get("day_high"), "day_low": q.get("day_low"), "volume": q.get("volume"),
            "week_high": q.get("week_high"), "week_low": q.get("week_low"),
            "ytd_gain": ytd_gain, "ytd_pct": ytd_pct,
            "fetched_at": q.get("fetched_at"),
            "is_stale": price is not None and resolved_key not in live_cached,
        })

    _log_portfolio(
        account=account,
        currency=acct.get("currency", ""),
        rows=rows,
        tw_resolved=bare_to_full if is_twd else None,
        stale_tickers=stale_tickers,
    )
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
    use_mock:           Optional[bool] = None
    col_vis:            Optional[list] = None   # legacy flat; kept for migration reads
    col_order:          Optional[list] = None   # legacy flat; kept for migration reads
    pnl_cols:           Optional[dict] = None   # { account_key: { vis: [...], order: [...] } }
    protected_accounts: Optional[list] = None   # list of account keys that cannot be deleted
    theme:              Optional[str]  = None   # active color theme ID
    crypto_sort:        Optional[dict] = None   # { col: "pct"|"price"|"volume", dir: "asc"|"desc" }
    group_sorts:        Optional[dict] = None   # { group_name: sort_mode_string }
    crypto_tickers:     Optional[list] = None   # list of Yahoo Finance crypto tickers e.g. ["BTC-USD"]
    account_groups:     Optional[list] = None   # [{ name: str, accounts: [str] }] user-defined portfolio groups


@app.get("/api/settings")
def get_settings():
    return load_settings()


@app.put("/api/settings")
def put_settings(body: SettingsBody):
    # Hold the lock for the entire read-modify-write cycle to prevent concurrent
    # requests from overwriting each other's changes with stale data.
    clear_crypto = False
    cf = _user_config_file()
    with _get_config_lock():
        try:
            with open(cf, "r") as f:
                file_data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            file_data = {}
        s = file_data.get("settings", {})
        s.setdefault("use_mock", False)
        s.setdefault("theme", "dark-cyber")
        s.setdefault("crypto_sort", {"col": "pct", "dir": "desc"})
        s.setdefault("group_sorts", {})
        s.setdefault("crypto_tickers", list(_DEFAULT_CRYPTO))
        s.setdefault("account_groups", [])
        s_before = json.loads(json.dumps(s))
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
        if body.protected_accounts is not None:
            s["protected_accounts"] = body.protected_accounts
        if body.theme is not None:
            s["theme"] = body.theme
        if body.crypto_sort is not None:
            s["crypto_sort"] = body.crypto_sort
        if body.group_sorts is not None:
            existing_gs = s.get("group_sorts", {})
            existing_gs.update(body.group_sorts)
            s["group_sorts"] = existing_gs
        if body.crypto_tickers is not None:
            tickers = [str(t) for t in body.crypto_tickers if isinstance(t, str) and t]
            if tickers:
                s["crypto_tickers"] = tickers
                clear_crypto = True
        if body.account_groups is not None:
            groups = []
            for g in body.account_groups:
                if isinstance(g, dict) and isinstance(g.get("name"), str) and isinstance(g.get("accounts"), list):
                    entry = {"name": g["name"], "accounts": [a for a in g["accounts"] if isinstance(a, str)]}
                    if g.get("locked"):
                        entry["locked"] = True
                    groups.append(entry)
            s["account_groups"] = groups
        _log_settings_change(s_before, s)
        file_data["settings"] = s
        with open(cf, "w") as f:
            json.dump(file_data, f, ensure_ascii=False, indent=2)
    if clear_crypto:
        with _crypto_cache_lock:
            _crypto_cache.clear()
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
        resolved_map = dict(zip(ticker_list, resolved))  # bare → resolved
        result = []
        for r in raw_rows:
            bare = resolved_to_bare.get(r["ticker"], r["ticker"])
            row = {**{k: v for k, v in r.items() if k != "ticker"}, "ticker": bare}
            name = _fetch_tw_name(bare, resolved_map.get(bare, bare))
            if name:
                row["name"] = name
            result.append(row)
        return result
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


@app.put("/api/groups/{group_name}/pin")
def toggle_group_pin(group_name: str):
    _require_real_mode()
    groups, portfolio, pinned, markets = load_config()
    if group_name not in groups:
        raise HTTPException(404, "group not found")
    if group_name in pinned:
        pinned = [p for p in pinned if p != group_name]
    else:
        pinned = pinned + [group_name]
    save_config(groups, portfolio, pinned, markets)
    return _groups_response(groups, pinned, markets)


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
    try:
        return _cached_portfolio_rows(account)
    except Exception:
        return []


@app.get("/api/portfolio/{account}/premarket-rows")
def get_premarket_rows(account: str):
    try:
        return _portfolio_premarket_rows(account)
    except Exception:
        return []


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


@app.put("/api/portfolio/accounts/order")
def reorder_accounts(body: OrderBody):
    _require_real_mode()
    groups, portfolio, pinned, markets = load_config()
    existing = set(portfolio.keys())
    new_order = [a for a in body.order if a in existing]
    if set(new_order) != existing:
        raise HTTPException(400, "order must contain exactly the same accounts")
    portfolio = {a: portfolio[a] for a in new_order}
    save_config(groups, portfolio, pinned, markets)
    return {"accounts": list(portfolio.keys())}


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


# ── Routes: account CRUD ───────────────────────────────────────────────────────
class AccountBody(BaseModel):
    name: str
    currency: str = "USD"   # "USD" or "TWD"


class AccountRenameBody(BaseModel):
    new_name: str


@app.post("/api/portfolio/accounts")
def create_account(body: AccountBody):
    _require_real_mode()
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "account name required")
    currency = body.currency if body.currency in ("USD", "TWD") else "USD"
    groups, portfolio, pinned, markets = load_config()
    if name in portfolio:
        raise HTTPException(409, "account already exists")
    portfolio[name] = {"currency": currency, "positions": {}}
    save_config(groups, portfolio, pinned, markets)
    s = load_settings()
    default_cols = s.get("pnl_cols", {}).get("__default__")
    if default_cols:
        existing_pnl = s.get("pnl_cols", {})
        existing_pnl[name] = default_cols
        existing_pnl[f"overall:{name}"] = default_cols
        s["pnl_cols"] = existing_pnl
        save_settings(s)
    return {"accounts": list(portfolio.keys()), "account": name, "currency": currency}


@app.put("/api/portfolio/accounts/{account}/rename")
def rename_account(account: str, body: AccountRenameBody):
    _require_real_mode()
    new_name = body.new_name.strip()
    if not new_name:
        raise HTTPException(400, "new name required")
    groups, portfolio, pinned, markets = load_config()
    if account not in portfolio:
        raise HTTPException(404, "account not found")
    if new_name in portfolio and new_name != account:
        raise HTTPException(409, "account name already exists")
    # Rebuild portfolio with the renamed key preserving insertion order
    portfolio = {(new_name if k == account else k): v for k, v in portfolio.items()}
    save_config(groups, portfolio, pinned, markets)
    return {"accounts": list(portfolio.keys())}


@app.delete("/api/portfolio/accounts/{account}")
def delete_account(account: str):
    _require_real_mode()
    protected = load_settings().get("protected_accounts", [])
    if account in protected:
        raise HTTPException(403, "account is protected from deletion")
    groups, portfolio, pinned, markets = load_config()
    if account not in portfolio:
        raise HTTPException(404, "account not found")
    positions = portfolio[account].get("positions", {})
    if positions:
        raise HTTPException(400, "cannot delete account with positions; remove all positions first")
    del portfolio[account]
    save_config(groups, portfolio, pinned, markets)
    return {"accounts": list(portfolio.keys())}


# ── Routes: history (K-line) ───────────────────────────────────────────────────
_history_cache: TTLCache = TTLCache(maxsize=200, ttl=60)
_history_cache_lock = threading.Lock()
_trading_days_cache: TTLCache = TTLCache(maxsize=10, ttl=3600)
_trading_days_lock = threading.Lock()

PERIOD_MAP = {
    "intra": ("1d",  "1m"),   # regular session only (no pre/post)
    "1d":    ("1d",  "1m"),   # full day including pre/post
    "2d":    (None,  "15m"),  # last N trading days, 15m, prepost — fetched dynamically
    "3d":    (None,  "15m"),
    "4d":    (None,  "15m"),
    "5d":    (None,  "15m"),
    "1w":    ("5d",  "15m"),
    "1m":    ("1mo", "1d"),
    "3m":    ("3mo", "1d"),
    "ytd":   ("ytd", "1d"),
    "1y":    ("1y",  "1d"),
    "5y":    ("5y",  "1wk"),
    "all":   ("max", "1mo"),
}


@app.get("/api/trading-days")
def get_trading_days(count: int = 10, market: str = "US"):
    cache_key = f"{market}:{count}"
    with _trading_days_lock:
        if cache_key in _trading_days_cache:
            return _trading_days_cache[cache_key]
    ref = "SPY" if market != "TW" else "0050.TW"
    try:
        df = yf.download(ref, period="1mo", interval="1d", progress=False, auto_adjust=True)
        if df.empty:
            return {"days": []}
        days = [ts.strftime("%Y-%m-%d") for ts in df.index[-count:]]
        days.reverse()  # most recent first
        result = {"days": days}
        with _trading_days_lock:
            _trading_days_cache[cache_key] = result
        return result
    except Exception:
        return {"days": []}


@app.get("/api/history/{ticker}")
def get_history(ticker: str, period: str = "1y", date: Optional[str] = None):
    ticker = ticker.upper()
    period = period.lower()
    if period not in PERIOD_MAP:
        raise HTTPException(400, f"invalid period; valid: {', '.join(PERIOD_MAP)}")
    yf_period, interval = PERIOD_MAP[period]
    cache_key = f"{ticker}:{period}:{date or ''}"
    with _history_cache_lock:
        if cache_key in _history_cache:
            return _history_cache[cache_key]
    fetch_ticker = ticker
    if not any(ticker.endswith(s) for s in (".TW", ".TWO", "-USD", "-USDT")):
        if ticker in TW_EXCHANGE:
            fetch_ticker = ticker + TW_EXCHANGE[ticker]
    try:
        # ── Choose fetch strategy ─────────────────────────────────────────────
        if period == "intra" and date:
            try:
                dt = datetime.strptime(date, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(400, "invalid date; expected YYYY-MM-DD")
            df = yf.download(fetch_ticker,
                             start=dt.strftime("%Y-%m-%d"),
                             end=(dt + timedelta(days=1)).strftime("%Y-%m-%d"),
                             interval="1m", progress=False, auto_adjust=True, prepost=False)
        elif period == "1d":
            now_utc = datetime.now(pytz.utc)
            start_utc = now_utc - timedelta(hours=24)
            df = yf.download(fetch_ticker,
                             start=start_utc, end=now_utc,
                             interval="1m", progress=False, auto_adjust=True, prepost=True)
        elif period in ("2d", "3d", "4d", "5d"):
            n = int(period[0])
            df_full = yf.download(fetch_ticker, period="5d", interval="15m",
                                  progress=False, auto_adjust=True, prepost=True)
            if df_full.empty:
                return []
            if hasattr(df_full.columns, "levels"):
                df_full = df_full.droplevel(1, axis=1)
            et_tz = pytz.timezone("America/New_York")
            unique_days = sorted({ts.astimezone(et_tz).strftime("%Y-%m-%d") for ts in df_full.index})
            if len(unique_days) < n:
                return []
            cutoff = unique_days[-n]
            df = df_full.loc[[ts for ts in df_full.index
                               if ts.astimezone(et_tz).strftime("%Y-%m-%d") >= cutoff]]
        else:
            df = yf.download(fetch_ticker, period=yf_period, interval=interval,
                             progress=False, auto_adjust=True, prepost=False)

        if df is None or df.empty:
            return []
        if hasattr(df.columns, "levels"):
            df = df.droplevel(1, axis=1)

        # ── Build bars ────────────────────────────────────────────────────────
        bars = []
        for ts, row in df.iterrows():
            bars.append({
                "t": int(ts.timestamp() * 1000),
                "o": float(row["Open"])   if row["Open"]   == row["Open"]   else None,
                "h": float(row["High"])   if row["High"]   == row["High"]   else None,
                "l": float(row["Low"])    if row["Low"]    == row["Low"]    else None,
                "c": float(row["Close"])  if row["Close"]  == row["Close"]  else None,
                "v": float(row["Volume"]) if "Volume" in row and row["Volume"] == row["Volume"] else None,
            })

        result = {"ticker": ticker, "period": period, "interval": interval, "bars": bars}

        # ── Session boundaries ────────────────────────────────────────────────
        if period == "intra" and date:
            is_tw = fetch_ticker.endswith((".TW", ".TWO"))
            if is_tw:
                tz = pytz.timezone("Asia/Taipei")
                dt_local = datetime.strptime(date, "%Y-%m-%d")
                open_ts  = tz.localize(dt_local.replace(hour=9,  minute=0))
                close_ts = tz.localize(dt_local.replace(hour=13, minute=30))
            else:
                tz = pytz.timezone("America/New_York")
                dt_local = datetime.strptime(date, "%Y-%m-%d")
                open_ts  = tz.localize(dt_local.replace(hour=9,  minute=30))
                close_ts = tz.localize(dt_local.replace(hour=16, minute=0))
            result["session_boundaries"] = [{
                "open":  int(open_ts.timestamp()  * 1000),
                "close": int(close_ts.timestamp() * 1000),
            }]
        elif period in ("1d", "2d", "3d", "4d", "5d"):
            et_tz = pytz.timezone("America/New_York")
            boundaries = []
            cur_day = None
            day_open = day_close = None
            for ts in df.index:
                ts_et = ts.astimezone(et_tz)
                d_str = ts_et.strftime("%Y-%m-%d")
                t = ts_et.time()
                ms = int(ts.timestamp() * 1000)
                if d_str != cur_day:
                    if cur_day is not None and day_open is not None:
                        entry = {"open": day_open}
                        if day_close is not None:
                            entry["close"] = day_close
                        boundaries.append(entry)
                    cur_day, day_open, day_close = d_str, None, None
                if day_open is None and dtime(9, 30) <= t < dtime(16, 0):
                    day_open = ms
                if day_open is not None and day_close is None and t >= dtime(16, 0):
                    day_close = ms
            if cur_day is not None and day_open is not None:
                entry = {"open": day_open}
                if day_close is not None:
                    entry["close"] = day_close
                boundaries.append(entry)
            if boundaries:
                result["session_boundaries"] = boundaries

        with _history_cache_lock:
            _history_cache[cache_key] = result
        return result
    except Exception:
        return []


# ── Routes: market overview ─────────────────────────────────────────────────────
_POPULAR_TW = [
    "2330", "2317", "2454", "2308", "2412", "2882", "2884", "6505", "3711",
    "2891", "2886", "2881", "2303", "2609", "1301", "1303", "2002", "2395",
    "00878", "00919", "0050", "0056", "00929", "00713",
]
_market_cache: TTLCache = TTLCache(maxsize=10, ttl=60)
_market_cache_lock = threading.Lock()


def _fetch_screener(scr_id: str, count: int = 25) -> list:
    url = (
        "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved"
        f"?formatted=false&scrIds={scr_id}&count={count}&start=0"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    quotes = data["finance"]["result"][0]["quotes"]
    rows = []
    for q in quotes:
        ticker = q.get("symbol")
        price = q.get("regularMarketPrice")
        pct = q.get("regularMarketChangePercent")
        vol = q.get("regularMarketVolume")
        name = q.get("shortName", "")
        if ticker and price is not None and pct is not None:
            rows.append({"ticker": ticker, "name": name, "price": price, "pct": pct, "volume": vol})
    return rows


@app.get("/api/market/overview")
def market_overview():
    with _market_cache_lock:
        if "us" in _market_cache:
            return _market_cache["us"]
    try:
        gainers = _fetch_screener("day_gainers")
        losers  = _fetch_screener("day_losers")
        actives = _fetch_screener("most_actives")
        result = {"gainers": gainers, "losers": losers, "actives": actives}
        with _market_cache_lock:
            _market_cache["us"] = result
        return result
    except Exception:
        return {"gainers": [], "losers": [], "actives": []}


@app.get("/api/market/tw-overview")
def market_tw_overview():
    with _market_cache_lock:
        if "tw" in _market_cache:
            return _market_cache["tw"]
    # resolve bare TW codes
    resolved = [b + TW_EXCHANGE.get(b, ".TW") for b in _POPULAR_TW]
    try:
        df = yf.download(resolved, period="5d", interval="1d", progress=False, auto_adjust=False)
        rows = []
        if not df.empty:
            is_multi = hasattr(df.columns, "levels")
            for bare, full in zip(_POPULAR_TW, resolved):
                try:
                    closes = df["Close"][full].dropna() if is_multi else df["Close"].dropna()
                    vols   = df["Volume"][full].dropna() if is_multi else df["Volume"].dropna()
                    if len(closes) >= 2:
                        price = float(closes.iloc[-1])
                        pct = (float(closes.iloc[-1]) - float(closes.iloc[-2])) / float(closes.iloc[-2]) * 100
                        vol = float(vols.iloc[-1]) if len(vols) else None
                        name = TW_NAMES.get(bare, "")
                        rows.append({"ticker": bare, "name": name, "price": price, "pct": pct, "volume": vol})
                except Exception:
                    pass
        result = {"stocks": rows}
        with _market_cache_lock:
            _market_cache["tw"] = result
        return result
    except Exception:
        return {"stocks": []}


# ── Routes: crypto ─────────────────────────────────────────────────────────────
_DEFAULT_CRYPTO = ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "XRP-USD",
                   "ADA-USD", "AVAX-USD", "DOGE-USD", "DOT-USD", "LINK-USD",
                   "MATIC-USD", "UNI-USD", "LTC-USD", "ATOM-USD", "FIL-USD"]
_crypto_cache: TTLCache = TTLCache(maxsize=10, ttl=60)
_crypto_cache_lock = threading.Lock()


@app.get("/api/crypto/quotes")
def crypto_quotes():
    with _crypto_cache_lock:
        if "quotes" in _crypto_cache:
            return _crypto_cache["quotes"]
    tickers = load_settings().get("crypto_tickers", _DEFAULT_CRYPTO)
    try:
        df = yf.download(tickers, period="5d", interval="1d", progress=False, auto_adjust=False)
        rows = []
        if not df.empty:
            is_multi = hasattr(df.columns, "levels")
            for t in tickers:
                try:
                    closes = df["Close"][t].dropna() if is_multi else df["Close"].dropna()
                    vols   = df["Volume"][t].dropna() if is_multi else df["Volume"].dropna()
                    if len(closes) >= 2:
                        price = float(closes.iloc[-1])
                        pct = (float(closes.iloc[-1]) - float(closes.iloc[-2])) / float(closes.iloc[-2]) * 100
                        vol = float(vols.iloc[-1]) if len(vols) else None
                        rows.append({"ticker": t, "price": price, "pct": pct, "volume": vol})
                except Exception:
                    pass
        result = {"coins": rows}
        with _crypto_cache_lock:
            _crypto_cache["quotes"] = result
        return result
    except Exception:
        return {"coins": []}


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


@app.get("/api/tw-search")
def tw_search(q: str = ""):
    """Search TW stocks by code prefix or Chinese name substring. Returns up to 8 results."""
    q = q.strip()
    if not q:
        return []
    q_up = q.upper()
    exact, prefix, name_match = [], [], []
    for code, name in TW_NAMES.items():
        if code == q_up:
            exact.append({"code": code, "name": name})
        elif code.startswith(q_up):
            prefix.append({"code": code, "name": name})
        elif q in name:
            name_match.append({"code": code, "name": name})
    return (exact + prefix + name_match)[:8]


# ── US stock name mapping (SEC EDGAR, refreshed daily) ───────────────────────
US_NAMES_FILE = os.path.join(os.path.dirname(__file__), "us_names.json")
_us_names: dict = {}       # { "AAPL": "Apple Inc.", ... } ~12K entries
_us_names_lock = threading.Lock()

# Fallback TTL cache for Yahoo Finance API (used only before local data is ready)
_us_search_fallback_cache: TTLCache = TTLCache(maxsize=200, ttl=120)
_us_search_fallback_lock = threading.Lock()


def _load_us_names() -> None:
    global _us_names
    try:
        with open(US_NAMES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        with _us_names_lock:
            _us_names = data
        print(f"[us_names] loaded {len(data)} entries")
    except (FileNotFoundError, json.JSONDecodeError):
        pass


def _refresh_us_names() -> None:
    """Download ticker→company mapping from SEC EDGAR and persist to us_names.json."""
    try:
        url = "https://www.sec.gov/files/company_tickers.json"
        req = urllib.request.Request(
            url, headers={"User-Agent": "stock-dashboard/1.0 (personal-use)"}
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = json.loads(resp.read())
        mapping: dict = {}
        for item in raw.values():
            ticker = str(item.get("ticker", "")).upper().strip()
            title  = str(item.get("title",  "")).strip()
            # Skip entries with spaces (warrants, units) or empty fields
            if ticker and title and " " not in ticker:
                mapping[ticker] = title
        with _us_names_lock:
            _us_names.clear()
            _us_names.update(mapping)
        with open(US_NAMES_FILE, "w", encoding="utf-8") as f:
            json.dump(mapping, f, ensure_ascii=False, separators=(",", ":"))
        print(f"[us_names] refreshed {len(mapping)} entries → {US_NAMES_FILE}")
    except Exception as e:
        print(f"[us_names] refresh failed: {e}")


def _us_names_daily_refresh() -> None:
    _refresh_us_names()
    while True:
        time.sleep(86400)   # wait 24 h then refresh again
        _refresh_us_names()


# Load from existing file immediately; background thread refreshes from SEC EDGAR
_load_us_names()
threading.Thread(target=_us_names_daily_refresh, daemon=True).start()


@app.get("/api/us-search")
def us_search(q: str = ""):
    """Search US stocks/ETFs by ticker prefix or company name substring."""
    q = q.strip()
    if not q:
        return []

    with _us_names_lock:
        snap = dict(_us_names)   # snapshot; ~12K entries, copy takes <1 ms

    if snap:
        q_up = q.upper()
        q_lo = q.lower()
        exact, prefix, name_match = [], [], []
        for code, name in snap.items():
            if code == q_up:
                exact.append({"code": code, "name": name})
            elif code.startswith(q_up):
                prefix.append({"code": code, "name": name})
            elif q_lo in name.lower():
                name_match.append({"code": code, "name": name})
        return (exact + prefix + name_match)[:8]

    # Fallback to Yahoo Finance API (only while local data is still downloading)
    key = q.lower()
    with _us_search_fallback_lock:
        if key in _us_search_fallback_cache:
            return _us_search_fallback_cache[key]
    try:
        url = (
            "https://query1.finance.yahoo.com/v1/finance/search"
            f"?q={urllib.parse.quote(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        results = [
            {"code": item["symbol"], "name": item.get("shortname") or item.get("longname", "")}
            for item in data.get("quotes", [])
            if item.get("isYahooFinance") and item.get("typeDisp") in ("Equity", "ETF", "Index")
        ][:8]
    except Exception:
        results = []
    with _us_search_fallback_lock:
        _us_search_fallback_cache[key] = results
    return results


_crypto_validate_cache: TTLCache = TTLCache(maxsize=200, ttl=300)
_crypto_validate_lock = threading.Lock()


@app.get("/api/validate/crypto/{ticker}")
def validate_crypto(ticker: str):
    t = ticker.upper().strip()
    if not t.endswith("-USD") and not t.endswith("-USDT"):
        t = t + "-USD"
    with _crypto_validate_lock:
        if t in _crypto_validate_cache:
            return _crypto_validate_cache[t]
    try:
        df = yf.download(t, period="5d", interval="1d", progress=False, auto_adjust=False)
        valid = not df.empty and len(df) >= 1
        result = {"valid": valid, "ticker": t}
    except Exception:
        result = {"valid": False, "ticker": t}
    with _crypto_validate_lock:
        _crypto_validate_cache[t] = result
    return result
