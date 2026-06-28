# Design Decisions — Stock Dashboard

> Key architectural choices, their rationale, trade-offs, and what not to casually change.

---

### Decision: Batch yfinance Download Instead of Per-Ticker Parallel Fetch

- **Decision:** All quote fetching uses a single `yf.download(all_tickers, period="5d")` call per request cycle, never `ThreadPoolExecutor` with per-ticker `yf.download` or `yf.Ticker(...).history()`.
- **Reason:** Per-ticker parallel fetching (8–24 concurrent HTTP requests during cache expiry) triggers Yahoo Finance's rate limiting. Rate-limited responses return empty DataFrames → `price=None` → null rendered in UI. A single batch call is treated as one request regardless of ticker count.
- **Trade-off:** Cannot fetch individual tickers asynchronously. All tickers for a group must be known upfront. Marginally slower first fetch but far more reliable.
- **Related files:** `backend/main.py` → `_fetch_quotes()`, `_fetch_ytd_batch()`, `_fetch_52w_batch()`, `_portfolio_rows()`
- **What not to change casually:** Do not refactor `_fetch_quotes` to use `ThreadPoolExecutor` or per-ticker `yf.Ticker(...).history()`. Do not split batch calls across multiple threads.

---

### Decision: Stale Quote Cache (`_quotes_stale`)

- **Decision:** A plain dict `_quotes_stale` (no TTL) stores the last known-good quote per ticker forever. When a fresh batch fetch fails, stale data is served instead of returning null.
- **Reason:** Network blips and rate limits are transient. Returning null causes the UI to show "—" for prices which is confusing and looks broken. Last-known price is almost always more useful than showing nothing.
- **Trade-off:** During a prolonged outage, stale prices could be hours old without any indicator. Currently no "stale" flag is surfaced to the frontend.
- **Related files:** `backend/main.py` → `_fetch_quotes()`, `_quotes_stale` global dict
- **What not to change casually:** Do not remove the stale fallback. Do not replace the plain dict with a short-TTL cache — the whole point is that it outlives `_quotes_cache`.

---

### Decision: Store Bare TW Codes, Resolve at Fetch Time

- **Decision:** TW stocks are stored as bare 4-digit codes (`"2330"`, not `"2330.TW"`). `_resolve_tw_ticker()` resolves the suffix at fetch time.
- **Reason:** A stock listed on TWSE gets `.TW`; one on TPEx gets `.TWO`. This can change (delistings, moves). Storing the resolved suffix would create stale entries. Bare codes are also more portable and human-readable.
- **Trade-off:** Every fetch cycle requires a resolution step. Mitigated by static lookup table (`TW_EXCHANGE`, 2340 entries) making most resolutions O(1).
- **Related files:** `backend/main.py` → `_resolve_tw_ticker()`, `_strip_tw_suffix()`, `backend/tw_exchange.py`
- **Related functions:** `_portfolio_rows()` for TWD accounts, `_ticker_exists_tw()`
- **What not to change casually:** Do not change portfolio storage to include `.TW`/`.TWO` without a schema migration. Do not bypass `_resolve_tw_ticker()` for TW tickers.

---

### Decision: Static TW Exchange Lookup Before yfinance Fallback

- **Decision:** `_resolve_tw_ticker()` checks `TW_EXCHANGE` static dict first. Only falls back to `yf.download` for codes not in the dict.
- **Reason:** Previous implementation used `yf.download` to detect the correct suffix. Under concurrent load, Yahoo Finance rate-limits some requests → empty DataFrames returned for `.TW` → fallback to `.TWO` → wrong exchange for TWSE stocks (e.g., 2330 台積電, 2412 中華電 incorrectly resolved to `.TWO`).
- **Trade-off:** Static dict requires periodic maintenance for new listings. Currently covers ~2340 stocks. New listings (warrants, new IPOs) still fall through to the yfinance fallback.
- **Related files:** `backend/tw_exchange.py`, `backend/main.py` → `_resolve_tw_ticker()`, `_ticker_exists_tw()`
- **What not to change casually:** Do not replace the static dict with a yfinance-only dynamic lookup. The static dict is the primary resolution path; yfinance is the exception.

---

### Decision: Demo Mode Protected at Backend API Layer

- **Decision:** All write endpoints call `_require_real_mode()` which raises HTTP 403 when `use_mock=True`. Frontend also disables write UI, but this is secondary.
- **Reason:** Frontend disabled state can be bypassed (browser dev tools, direct API calls). The backend 403 ensures demo data is never modified regardless of frontend state. Important when sharing a demo session.
- **Trade-off:** Two layers of protection to maintain. Must remember to call `_require_real_mode()` in every new write endpoint.
- **Related files:** `backend/main.py` → `_require_real_mode()`, all POST/PUT/DELETE handlers; `frontend/app/page.tsx` → `useMock` prop propagation; `frontend/app/components/PortfolioTab.tsx`, `GroupTab.tsx`
- **What not to change casually:** Do not remove `_require_real_mode()` calls thinking "frontend already blocks it". Do not add `useMock` checks only in the frontend without backend enforcement.

---

### Decision: Versioned Schema Migration System

- **Decision:** `user_data.json` has `schema_version` (currently 2). Migrations run automatically in `load_config()` before any data is used. Each migration is idempotent and non-destructive.
- **Reason:** The file format has changed multiple times (v0: bare flat dict; v1: multi-account; v2: `group_markets` field). Users upgrading from older app versions would silently lose data or crash without migrations.
- **Trade-off:** Every format change requires writing and registering a migration. Slight overhead on first load after upgrade.
- **Related files:** `backend/main.py` → `_migrate_v1()`, `_migrate_v2()`, `run_migrations()`, `SCHEMA_VERSION`
- **What not to change casually:** Do not add new fields to `user_data.json` without a migration. Do not make migrations conditional on anything other than `schema_version`. Do not delete fields in migrations (could break downgrade).

---

### Decision: `settingsLoaded` Guard in `page.tsx`

- **Decision:** All tab content (`PortfolioTab`, `GroupTab`, etc.) is gated on a `settingsLoaded` boolean that becomes true only after `api.getSettings()` returns.
- **Reason:** Without this, components mount with `useMock=false` (default) while settings are still loading. If the user is in demo mode, components briefly fetch real data before the settings response arrives, causing a visible flash and wasted API calls.
- **Trade-off:** Adds a brief loading delay on cold start before any tab content renders.
- **Related files:** `frontend/app/page.tsx` → `settingsLoaded` state, `loadMeta()`
- **What not to change casually:** Do not remove the `settingsLoaded` gate or move settings loading out of the initial `Promise.all`. See `REGRESSION_NOTES.md` for the original bug.

---

### Decision: Optimistic Update for Account Reordering

- **Decision:** `handleReorderAccounts()` in `PortfolioTab.tsx` updates local `portfolio` state immediately (optimistic), then syncs to backend. On failure, reverts by calling `loadPortfolio()`.
- **Reason:** Backend sync adds 100–300ms latency. Without optimistic update, the tab bar snaps back to old order during the request, creating a jarring animation.
- **Trade-off:** Briefly out-of-sync with backend. Revert on failure may cause a confusing snap-back if network is very slow.
- **Related files:** `frontend/app/components/PortfolioTab.tsx` → `handleReorderAccounts()`
- **What not to change casually:** Do not move the `setPortfolio()` call to after `await api.reorderAccounts()`.

---

### Decision: Chart Domain / Padding Calculated Manually

- **Decision:** Recharts chart domains are manually computed (e.g., Y-axis = max value × 1.2, X-axis = max value × 1.25). Not relying on Recharts `"auto"` domain.
- **Reason:** Recharts `"auto"` domain clips bars and bubbles at the SVG boundary when values are near the axis edge. Manually padding the domain gives breathing room. This was fixed after visible clipping of large bubble radii (~62px) and waterfall bar value labels.
- **Trade-off:** Must be maintained manually. Domain calculation runs on every render.
- **Related files:** `frontend/app/components/PnLChart.tsx` → `BubbleChart`, `WaterfallChart`, `BarChartView`
- **What not to change casually:** Do not revert domain calculations to `"auto"`. Do not reduce padding constants (xPad 0.30, yPad 0.50 for bubble; +20% for waterfall Y; +25% for bar X).

---

### Decision: Rename Uses `onBlur` + Escape-Flag Ref, Not Just `onKeyDown`

- **Decision:** Group and account rename inputs commit on `onBlur`, with a `renameEscRef` flag to suppress the blur-triggered save when the user pressed Escape.
- **Reason:** If both `onKeyDown` (Enter → save) and `onBlur` (focus lost → save) are active, pressing Enter triggers both events: Enter fires the save, then the input loses focus and fires blur, causing a duplicate API call. The escape-flag prevents the blur from calling save after Escape.
- **Trade-off:** Slightly more complex event handling.
- **Related files:** `frontend/app/page.tsx` → `handleRenameGroup()`, `renameEscRef`; `frontend/app/components/PortfolioTab.tsx` → `handleRenameAccount()`
- **What not to change casually:** Do not simplify rename to `onKeyDown` only (would break blur-to-confirm). Do not remove `renameEscRef` — it prevents the double-save bug.

---

### Decision: FastAPI + Next.js (Not Streamlit)

- **Decision:** Primary stack is FastAPI backend + Next.js frontend. The original Streamlit version (`stock_dashboard.py`) is kept locally but not maintained.
- **Reason:** Streamlit's rerun model limits interactivity (tab navigation resets state, drag-drop requires third-party components, limited CSS control). FastAPI + Next.js gives full control over UI state, animations, and real-time updates without full-page rerenders.
- **Trade-off:** Much more complex to set up (two processes, separate build). Streamlit was single-file, zero deployment friction.
- **Related files:** `stock_dashboard.py` (local only, gitignored), `README_streamlit.md` (local only, gitignored)
- **What not to change casually:** Do not try to keep Streamlit in sync with the JS version. It is intentionally frozen.

---

### Decision: Per-Account Column Settings with Global Fallback

- **Decision:** `PnLTable` settings (visible columns, order, dividers) are stored per-account under `pnl_cols[accountName]` in `settings`. A top-level `col_vis` / `col_order` serves as fallback for accounts with no per-account settings.
- **Reason:** Different accounts (USD vs TWD) may want different column sets. Allows the TWD account to show Chinese stock names while USD accounts do not.
- **Trade-off:** Settings object grows per account. `applyTo()` feature copies one account's settings to another.
- **Related files:** `frontend/app/components/PnLTable.tsx` → `savePrefs()`, `buildCols()`; `backend/main.py` → `load_settings()`, `save_settings()`
- **What not to change casually:** Do not flatten per-account settings to a single global setting — this would break accounts that have customized their column set.

---

### Decision: TW Stock Color Convention (Red = Up, Green = Down)

- **Decision:** `--red` (`#C05640`) represents positive/up moves; `--green` (`#3DAA70`) represents negative/down moves. This is Taiwan stock market convention (opposite of Western convention).
- **Reason:** The app is primarily used by a Taiwanese user following local market convention. Using Western convention (green = up) would cause constant confusion.
- **Trade-off:** Western users might be confused.
- **Related files:** `frontend/app/globals.css` → `.pos`, `.neg`; `frontend/app/components/PnLChart.tsx`; `frontend/app/components/StockCard.tsx`; `frontend/app/components/MarketTab.tsx`
- **What not to change casually:** Do not flip red/green to Western convention. `--red` and `--green` are intentionally fixed (not theme-dependent) specifically to always represent up/down.

---

### Decision: US Market Overview Uses Yahoo Finance Screener API (Not Fixed List)

- **Decision:** `GET /api/market/overview` calls the Yahoo Finance screener API (`day_gainers`, `day_losers`, `most_actives`) for real market-wide data. An earlier version used a hardcoded list of ~45 popular US stocks.
- **Reason:** A fixed list of popular stocks (AAPL, MSFT, NVDA...) doesn't show actual market-wide movers. Small caps and sector runners that dominate a given day won't appear. The screener returns real top-25 per category across all US stocks.
- **Trade-off:** Screener API is not officially documented and could change. Uses `urllib.request` with a Mozilla User-Agent header (no `requests` library in backend).
- **Related files:** `backend/main.py` → `_fetch_screener()`, `market_overview()`
- **What not to change casually:** Do not revert to a fixed stock list for the US market overview.

---

### Decision: K-Line `intra` Period vs `1d` Period

- **Decision:** Two "today" periods exist: `intra` (regular session only, 9:30–16:00 ET) and `1d` (full day including pre/post market). They use different yfinance parameters.
- **Reason:** Users may want to see only the regular session or the full extended trading day.
- **Trade-off:** Inference — exact distinction not confirmed from user stories. `TODO: Verify whether both are exposed in the UI or only one.`
- **Related files:** `backend/main.py` → `PERIOD_MAP`, `get_history()`; `frontend/app/stock/[ticker]/page.tsx`

---

### Decision: Account Protection Is UX-Only, Not a Backend Security Feature

- **Decision:** `protected_accounts` in settings stores which accounts show a lock icon and hide the delete button. The backend delete endpoint is NOT aware of this setting — it only blocks deletion if positions exist.
- **Reason:** This is purely to prevent accidental deletion ("fat-finger protection"), not security. The real protection is "can't delete if positions exist" enforced at the backend.
- **Trade-off:** A user could delete a protected empty account via direct API call. This is intentional — protection is cosmetic/UX.
- **Related files:** `frontend/app/components/PortfolioTab.tsx` → `protectedAccounts`, `toggleProtect()`; `backend/main.py` → `DELETE /api/portfolio/accounts/{account}`
- **What not to change casually:** Do not add `protected_accounts` enforcement to the backend delete endpoint — the current design is intentional.
