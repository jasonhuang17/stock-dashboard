# AI Dev Context — Stock Dashboard

> Primary reference for AI agents entering this project. Read this after `CLAUDE.md`.

---

## Project Overview

A full-stack personal stock portfolio dashboard. Supports real-time US and Taiwan stock quotes, multi-account portfolio P&L tracking, watchlist groups, market overview, crypto, and K-line charts. All data is local — no auth, no cloud sync, no database.

**Primary users:** The owner (Jason Huang), single-user local tool.

**Key user flows:**
1. Check today's P&L across all portfolio accounts
2. Browse watchlist groups (cards, charts, premarket)
3. Add/edit/delete positions in portfolio accounts
4. View K-line chart for any ticker
5. Check market-wide top movers (US screener) and TW popular stocks
6. Switch to demo mode to share/demo without exposing real holdings

---

## Architecture

```
stock-dashboard/
├── start-js.sh        One-command launch (backend + frontend)
├── CLAUDE.md          AI agent entry point (read this first)
├── DEV_LOG.md         Changelog + technical notes (gitignored)
├── README.md          User-facing docs
├── docs/              AI dev documentation (committed)
├── js/               JS version
│   ├── backend/       FastAPI Python backend (port 8000)
│   │   ├── main.py        All routes + business logic (~1400 lines)
│   │   ├── demo_data.json Read-only demo portfolio (committed)
│   │   ├── tw_exchange.py Static dict: bare TW code → ".TW" | ".TWO" (~2340 entries)
│   │   ├── tw_names.py    Static dict: bare TW code → Chinese name (~5083 entries)
│   │   └── requirements.txt
│   ├── frontend/      Next.js 15 frontend (port 3000)
│   │   ├── app/
│   │   │   ├── page.tsx               Main dashboard (tabs, groups, header)
│   │   │   ├── layout.tsx             Root layout + ThemeInitializer
│   │   │   ├── globals.css            CSS vars, utility classes
│   │   │   ├── stock/[ticker]/page.tsx  K-line chart page
│   │   │   └── components/
│   │   │       ├── PortfolioTab.tsx   Portfolio P&L + manage
│   │   │       ├── PnLTable.tsx       Sortable, column-picker table
│   │   │       ├── PnLChart.tsx       Recharts (bubble/waterfall/treemap/bar)
│   │   │       ├── GroupTab.tsx       Watchlist group (cards + charts + premarket)
│   │   │       ├── MarketTab.tsx      US screener + TW popular stocks
│   │   │       ├── CryptoTab.tsx      15 crypto coins
│   │   │       ├── StockCard.tsx      Single quote card
│   │   │       ├── SortableChips.tsx  dnd-kit drag-drop reordering
│   │   │       ├── ThemeSelector.tsx  9-theme switcher (localStorage)
│   │   │       └── ThemeInitializer.tsx  Apply saved theme on mount
│   │   └── lib/
│   │       ├── api.ts     Typed API client (all backend calls)
│   │       ├── types.ts   Shared TypeScript interfaces
│   │       └── themes.ts  Theme definitions + applyTheme() / loadSavedTheme()
│   └── user_data.json Local user data, schema v2 (gitignored)
└── py/                Python/Streamlit version (all gitignored, not maintained)
```

**Streamlit version** (`stock_dashboard.py`, gitignored locally): original Python single-file implementation, no longer maintained. Separate `README_streamlit.md` documents it locally. All active development is on the JS version.

---

## Backend Architecture (`js/backend/main.py`)

### Config & Persistence

Two JSON files:

| File | Committed | Purpose |
|------|-----------|---------|
| `js/user_data.json` | No (gitignored) | Real user data: groups, portfolio, settings |
| `js/backend/demo_data.json` | Yes | Read-only demo portfolio (55+ US stocks, TW stocks) |

```python
# Paths use os.path.dirname(__file__) so they're always relative to main.py's location
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "..", "user_data.json")  # → js/user_data.json
DEMO_FILE   = os.path.join(os.path.dirname(__file__), "demo_data.json")        # → js/backend/demo_data.json
SCHEMA_VERSION = 2
```

`load_config()` → `run_migrations()` → returns `(groups, portfolio, pinned_groups, group_markets)`

`save_config()` uses `_config_lock` (threading.Lock) for thread safety.

`load_settings()` / `save_settings()` read/write the `settings` sub-dict.

### Demo Mode

**Backend enforces read-only in demo mode at the API layer:**

```python
def _require_real_mode():
    if load_settings().get("use_mock"):
        raise HTTPException(403, "read-only in demo mode")
```

All POST/PUT/DELETE endpoints call this first. `active_groups()` and `active_portfolio()` return demo data when `use_mock=True`.

Frontend also disables all write UI when `useMock=True`, but this is **UX only** — the backend 403 is the real protection.

### Cache Architecture

All caches are `TTLCache` from `cachetools` or plain `dict`:

| Cache | Type | TTL | Key | Purpose |
|-------|------|-----|-----|---------|
| `_quotes_cache` | TTLCache | 28s | ticker | Day bar quotes |
| `_quotes_stale` | dict | ∞ | ticker | Last known-good fallback (never expires) |
| `_premarket_cache` | TTLCache | 60s | ticker | Pre/post 1m quotes |
| `_exists_cache` | TTLCache | 300s | ticker | Ticker validation |
| `_tw_resolve_cache` | TTLCache | 3600s | bare code | .TW/.TWO suffix |
| `_tw_name_cache` | dict | ∞ | bare code | Chinese names (permanent) |
| `_ytd_cache` | TTLCache | 86400s | ticker | YTD start price |
| `_52w_cache` | TTLCache | 3600s | ticker | 52W high/low (background) |
| `_history_cache` | TTLCache | 60s | (ticker,period,date) | K-line bars |
| `_market_cache` | TTLCache | 60s | "us"/"tw" | Market overview screener |
| `_crypto_cache` | TTLCache | 60s | "quotes" | Crypto coin quotes |
| `_trading_days_cache` | TTLCache | 3600s | (count,market) | Trading day list |

All caches use `threading.Lock` for thread safety.

### Quote Fetching — Critical Design

```python
def _fetch_quotes(tickers: tuple) -> list[dict]:
```

- Uses a **single** `yf.download(all_missing_tickers, period="5d")` call — never per-ticker threads
- Cache misses collected first, fetched in one batch
- On fetch failure: serves from `_quotes_stale` (last known-good, no expiry)
- 52W H/L fetched in a **background daemon thread** via `_fetch_52w_batch()` (period="1y") to avoid blocking
- Sparse tickers (only 1 daily bar returned): fallback to `yf.Ticker(t).fast_info.get("previousClose")`

**Why this matters:** Per-ticker parallel threads caused Yahoo Finance rate limiting → null quotes. See `docs/REGRESSION_NOTES.md`.

### TW Ticker Resolution

TW stocks are stored as bare codes (`2330`) in `user_data.json`. On every fetch:

1. **Fast path**: `TW_EXCHANGE[bare]` → `.TW` or `.TWO` (2340 known stocks, O(1))
2. **Fallback**: `yf.download(bare+".TW")` then `yf.download(bare+".TWO")`, cached 1h

`_strip_tw_suffix(ticker)` removes any suffix before storage.

**Why bare codes:** The same stock can exist on both exchanges. Storing the resolved suffix would break if a stock moves exchanges. Resolution is cheap (dict lookup) and always accurate.

### Schema Migration

`SCHEMA_VERSION = 2`. Migrations run automatically in `load_config()`:

```python
_MIGRATIONS: dict = {1: _migrate_v1, 2: _migrate_v2}

def run_migrations(data: dict) -> tuple[dict, bool]:
    current = data.get("schema_version", 0)
    for v in range(current + 1, SCHEMA_VERSION + 1):
        if v in _MIGRATIONS:
            data = _MIGRATIONS[v](data)
    data["schema_version"] = SCHEMA_VERSION
    return data, True
```

Each migration is idempotent. Uses `if "key" not in data` guards. Never deletes fields.

**Adding a migration:** See `CLAUDE.md` → "資料格式版本管理".

### All API Routes

**Read-only:**
- `GET /api/health`
- `GET /api/market-status`
- `GET /api/settings`
- `GET /api/quotes?tickers=&market=`
- `GET /api/premarket?tickers=`
- `GET /api/history/{ticker}?period=&date=`
- `GET /api/trading-days?count=&market=`
- `GET /api/market/overview` → `{gainers, losers, actives}` (Yahoo screener, 25 each)
- `GET /api/market/tw-overview` → `{stocks}` (hardcoded popular TW list)
- `GET /api/crypto/quotes` → `{coins}` (15 hardcoded coins)
- `GET /api/validate/us/{ticker}`
- `GET /api/validate/tw/{ticker}`
- `GET /api/groups`
- `GET /api/portfolio`
- `GET /api/portfolio/{account}/rows`
- `GET /api/portfolio/{account}/premarket-rows`

**Write (all guarded by `_require_real_mode()`):**
- `PUT /api/settings`
- `POST /api/groups` / `DELETE /api/groups/{name}` / `PATCH /api/groups/{name}`
- `PUT /api/groups/order` / `PUT /api/groups/{name}/pin`
- `POST /api/groups/{name}/tickers` / `DELETE /api/groups/{name}/tickers/{ticker}`
- `PUT /api/groups/{name}/order`
- `POST /api/portfolio/{account}/positions`
- `PUT /api/portfolio/{account}/positions/{ticker}`
- `DELETE /api/portfolio/{account}/positions/{ticker}`
- `PUT /api/portfolio/{account}/order`
- `PUT /api/portfolio/accounts/order` ← must be defined BEFORE `/{account}/order`
- `POST /api/portfolio/accounts` / `PUT /api/portfolio/accounts/{account}/rename`
- `DELETE /api/portfolio/accounts/{account}` (blocked if positions exist)

**Important:** `PUT /api/portfolio/accounts/order` must be defined **before** `PUT /api/portfolio/{account}/order` in `main.py` to avoid FastAPI routing the literal string "accounts" as a `{account}` param.

---

## Frontend Architecture

### Tech Stack
- **Next.js 15** (App Router, `"use client"` for interactive pages)
- **React 19** (hooks only, no class components)
- **TypeScript 5** (strict)
- **Tailwind CSS v4**
- **dnd-kit** for drag-drop (groups, accounts, positions, tickers)
- **Recharts** for charts (bubble, waterfall, treemap, bar)

### State Management

No global state manager. All state is local React `useState`/`useCallback`:

- `page.tsx`: groups, pinned, markets, tab, useMock, settingsLoaded, countdown/refreshKey
- `PortfolioTab.tsx`: portfolio, acctTab, pnlTab, protectedAccounts
- `GroupTab.tsx`: quotes, premarket, subTab, sortMode
- `PnLTable.tsx`: sortState, optCols, colOrder, dividers (all persisted to backend settings)

**Tab persistence via `sessionStorage`:**
- `"dashboard-tab"` — main tab index
- `"portfolio-acct-tab"` — portfolio account tab
- `"group-subtab-{groupName}"` — per-group sub-tab

**Theme persistence via `localStorage`:**
- `"stock-dashboard-theme"` — theme ID

### `settingsLoaded` Guard (Critical)

In `page.tsx`, all tab content is gated on `settingsLoaded`:
```tsx
{settingsLoaded && tab === 0 && <PortfolioTab ... />}
```

Without this, components mount with `useMock=false` before settings load, causing a flash of real-data fetch on page reload in demo mode. See `REGRESSION_NOTES.md`.

### Component Responsibilities

| Component | Tab | Key Responsibility |
|-----------|-----|--------------------|
| `page.tsx` | Root | Tab nav, group CRUD, demo toggle, countdown |
| `PortfolioTab` | 💼 持倉 | Account tabs, P&L view, position management |
| `AccountPnL` | (nested) | Summary bar, PnLTable, PnLChart, after-hours |
| `ManageTab` | (nested) | Add/edit/delete positions, drag reorder |
| `OverallTab` | (nested) | Cross-account aggregated P&L by currency |
| `GroupTab` | ⚡ 個股 etc. | Ticker cards, charts, premarket, add/remove tickers |
| `MarketTab` | 📈 市場 | US screener (gainers/losers/actives) + TW list |
| `CryptoTab` | ₿ 加密 | 15 crypto coin cards + table |
| `PnLTable` | (used in AccountPnL, OverallTab) | Column picker, sort, dividers |
| `PnLChart` | (used in AccountPnL, OverallTab) | 4 chart types × 2 modes |
| `StockCard` | (used in GroupTab) | Single quote card (price + pct) |
| `SortableChips` | (used in ManageTab, GroupTab) | dnd-kit chip reorder UI |
| `ThemeSelector` | (header) | 9 theme dropdown |
| `ThemeInitializer` | (layout.tsx) | Apply saved theme on mount |
| `stock/[ticker]/page.tsx` | Route | K-line chart, period picker |

### Shared Types (`frontend/lib/types.ts`)

Key interfaces: `Quote`, `PremarketQuote`, `PortfolioRow`, `PremarketPortfolioRow`, `Position`, `Account`, `Portfolio`, `Groups`, `MarketStatus`, `Market`, `SortState`

`PortfolioRow` has 19 fields including: `ticker`, `name?`, `shares`, `avg_cost`, `price`, `pct`, `today_gain`, `unreal_gain`, `unreal_pct`, `cost_basis`, `day_high`, `day_low`, `volume`, `week_high`, `week_low`, `ytd_gain`, `ytd_pct`

### Theme System (`frontend/lib/themes.ts`)

9 themes. `applyTheme()` sets CSS custom properties on `:root`:
`--bg`, `--text`, `--dim`, `--blue`, `--teal`, `--gold`, `--card-bg`, `--card-border`, `--teal-alpha12`, `--teal-alpha35`

**`--red` and `--green` are NOT theme-dependent** — always `#C05640` / `#3DAA70` (Taiwan stock color convention: red = up, green = down).

`ThemeInitializer` (in `layout.tsx`) applies the saved theme on mount. Required to prevent flash on hard reload.

---

## Data Flow

### Quote Fetch Flow (GroupTab / PortfolioTab)

```
Frontend (refreshKey changes every 30s)
  → api.quotes(tickers, market)
  → GET /api/quotes?tickers=AAPL,MSFT&market=US
  → _fetch_quotes(("AAPL","MSFT"))
      → check _quotes_cache per ticker
      → collect misses
      → yf.download(all_misses, period="5d") [ONE HTTP call]
      → populate _quotes_cache + _quotes_stale
      → merge cached + fresh results
  → return Quote[]
```

### Portfolio P&L Flow

```
Frontend (account tab mounts)
  → api.portfolioRows(account)
  → GET /api/portfolio/{account}/rows
  → _portfolio_rows(account)
      → load positions from user_data.json (or demo_data.json)
      → for TWD: resolve all bare codes → full suffixes
      → _fetch_quotes(all_tickers) [batch]
      → _fetch_ytd_batch(tickers) [single yf.download period="ytd"]
      → merge quote + ytd data per position
      → calculate today_gain, unreal_gain, ytd_gain per row
  → return PortfolioRow[]
```

### US Market Overview Flow (every 60s cache)

```
GET /api/market/overview
  → _fetch_screener("day_gainers") [urllib.request → Yahoo Finance screener API]
  → _fetch_screener("day_losers")
  → _fetch_screener("most_actives")
  → return {gainers: [...], losers: [...], actives: [...]}  (25 each)
```

### Schema Migration Flow (startup)

```
Backend starts → first request hits load_config()
  → read user_data.json
  → run_migrations(data)
      → check schema_version (default 0 if missing)
      → apply _migrate_v1 if needed
      → apply _migrate_v2 if needed
      → set schema_version = SCHEMA_VERSION
  → if changed: save_config() immediately
  → return (groups, portfolio, pinned, markets)
```

---

## `user_data.json` Schema (v2)

```json
{
  "schema_version": 2,
  "group_tickers": {
    "⚡ 個股": ["AAPL", "MSFT", "..."],
    "🚀 槓桿型": ["TQQQ", "SQQQ", "..."],
    "🌐 大盤型": ["VOO", "SPY", "..."]
  },
  "group_markets": {
    "⚡ 個股": "US",
    "🚀 槓桿型": "US",
    "🌐 大盤型": "US"
  },
  "pinned_groups": ["⚡ 個股", "🚀 槓桿型", "🌐 大盤型"],
  "portfolio": {
    "美股複委託（台幣帳戶）": {
      "currency": "USD",
      "positions": {
        "AAPL": { "shares": 80, "avg_cost": 172.45, "total_cost": 13796.0 }
      }
    },
    "台股帳戶": {
      "currency": "TWD",
      "positions": {
        "2330": { "shares": 2000, "avg_cost": 1820.0, "total_cost": 3640000.0 }
      }
    }
  },
  "settings": {
    "use_mock": false,
    "col_vis": ["ticker", "shares", "price", "pct", "today_gain", "unreal_gain"],
    "col_order": ["ticker", "shares", "..."],
    "pnl_cols": {
      "AccountName": { "vis": [...], "order": [...], "dividers": [...] }
    },
    "protected_accounts": ["美股複委託（台幣帳戶）"]
  }
}
```

**Notes:**
- TW positions stored as bare codes (`"2330"`, not `"2330.TW"`)
- `total_cost` optional; if absent, `avg_cost * shares` is used as cost basis
- `protected_accounts` stored in `settings`, not portfolio — it's a UI preference, not enforced by backend delete endpoint (backend already blocks delete if positions exist)
- `pinned_groups` controls which groups show a lock icon and block deletion
- Column settings (`col_vis`, `col_order`, `pnl_cols`) are per-account and global fallback
