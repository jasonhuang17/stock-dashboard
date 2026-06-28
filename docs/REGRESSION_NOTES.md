# Regression Notes — Stock Dashboard

> Bug history, root causes, fixes, and defensive logic that must not be casually removed.

---

## Bug Fixes

### Bug: Intermittent Null Quotes (yfinance Rate Limiting)

- **Problem:** Many stocks showed "—" / null price intermittently, especially shortly after page load or after switching tabs.
- **Root cause:** `ThreadPoolExecutor(max_workers=5–8)` was spawning per-ticker `yf.download()` or `yf.Ticker.history()` calls. With 3 portfolio accounts × ~8 tickers each = up to 24 concurrent yfinance HTTP requests per 28s cache expiry cycle. Yahoo Finance's rate limiter returned empty DataFrames for some requests → `price=None` → null displayed.
- **Fix 1 (partial):** Reduced `max_workers` to limit concurrency.
- **Fix 2 (final):** Replaced all per-ticker fetches with a **single** `yf.download(all_missing_tickers, period="5d")` call. ONE HTTP request regardless of ticker count. No thread pool.
- **Fix 3:** Added `_quotes_stale` dict (no TTL) — on fetch failure, serves last known-good price instead of null.
- **Prevention:** `_fetch_quotes()` must remain a single-batch call. Do not refactor back to per-ticker parallel fetching. Any new quote-fetching code should route through `_fetch_quotes()`.
- **Related files:** `backend/main.py` → `_fetch_quotes()`, `_quotes_stale`
- **Verification:** 30 consecutive `/api/quotes` calls with 8+ tickers → 0 nulls across all calls.

---

### Bug: 52W High/Low Unavailable with Batch Download

- **Problem:** After switching to `yf.download(period="5d")` for quotes, 52W high/low were always null.
- **Root cause:** `yf.download(period="5d")` returns only 5 days of OHLCV; yearHigh/yearLow not included. Old implementation used `yf.Ticker.fast_info` which had these fields but was abandoned due to rate limits.
- **Fix:** Background daemon thread `_fetch_52w_batch()` calls `yf.download(tickers, period="1y")` and populates `_52w_cache(ttl=3600)`. Main quote fetch merges 52W data from cache without blocking.
- **Prevention:** Do not remove the background thread or merge the 52W fetch into the main quote fetch (would double the data volume of every quote request).
- **Related files:** `backend/main.py` → `_fetch_52w_batch()`, `_52w_cache`, `_fetch_quotes()`

---

### Bug: YTD Gain Always Null (Rate Limiting on Per-Ticker YTD Fetch)

- **Problem:** YTD gain column showed "—" for most positions.
- **Root cause:** `_fetch_ytd_start()` used `ThreadPoolExecutor` to fetch year-start price per ticker. Under concurrent load this hit the same Yahoo Finance rate limit as the original quote fetching issue.
- **Fix:** Replaced with a single `yf.download(tickers_list, period="ytd")` batch call via `_fetch_ytd_batch()`. Same pattern as quotes fix.
- **Related files:** `backend/main.py` → `_fetch_ytd_batch()`, `_ytd_cache`

---

### Bug: YTD Fetch Fails for Stocks IPO'd After Jan 1

- **Problem:** `yf.download(ticker, period="ytd")` returns empty for stocks that went public after January 1 of the current year. YTD gain shows null.
- **Root cause:** `period="ytd"` starts from Jan 1. If the stock didn't exist on Jan 1, yfinance returns nothing.
- **Fix:** Fallback to `period="1y"` when `period="ytd"` returns empty, then use the earliest available date as the YTD start.
- **Related files:** `backend/main.py` → `_fetch_ytd_batch()`

---

### Bug: TW Ticker Resolved to Wrong Exchange (.TWO for TWSE stocks)

- **Problem:** Stocks like 2330 (台積電) and 2412 (中華電) were sometimes resolved to `.TWO` (TPEx) instead of the correct `.TW` (TWSE).
- **Root cause:** `_resolve_tw_ticker()` originally used `yf.download(bare+".TW")` to detect the correct suffix. Under rate limiting, this returned an empty DataFrame → fell back to trying `.TWO` → success (yfinance sometimes returns partial data) → cached the wrong suffix for 1 hour.
- **Fix:** Added `backend/tw_exchange.py` — a static dict of ~2340 known TW stocks mapped to their correct exchange. `_resolve_tw_ticker()` checks this dict first (O(1)); yfinance fallback only for codes not in the dict (new listings, warrants, special securities).
- **Prevention:** Do not replace the static dict lookup with yfinance-only resolution. The dict is the primary source of truth.
- **Related files:** `backend/tw_exchange.py`, `backend/main.py` → `_resolve_tw_ticker()`, `_ticker_exists_tw()`
- **Verification:** 2330, 2317, 2412, 2882 all resolve to `.TW`; TPEx stocks like 6505 resolve to `.TWO`.

---

### Bug: Demo Mode Reload Flash (Real Data Briefly Loaded)

- **Problem:** On page reload in demo mode, the portfolio tab briefly showed real account data before switching to demo data.
- **Root cause:** `PortfolioTab` and `GroupTab` mounted immediately with `useMock=false` (the React default). Settings fetch (`api.getSettings()`) was async — components started fetching real portfolio data before the response arrived confirming `use_mock=true`.
- **Fix:** Added `settingsLoaded` boolean to `page.tsx`. All tab content is gated: `{settingsLoaded && tab === 0 && <PortfolioTab ... />}`. Nothing renders until settings are confirmed.
- **Prevention:** Do not remove the `settingsLoaded` gate. Do not move settings loading to individual component mounts.
- **Related files:** `frontend/app/page.tsx` → `settingsLoaded`, `loadMeta()`

---

### Bug: Group Tab State Reset on Every Parent Re-render

- **Problem:** `GroupTab` was re-mounting on every countdown tick, resetting sub-tab selection and triggering unnecessary quote fetches.
- **Root cause:** `Inference:` Likely caused by the countdown interval updating parent state (`setCountdown`) every second, causing the conditional tab rendering to re-evaluate. Without `key` stability or memoization, child components could unmount/remount.
- **Fix:** `Inference:` The `tickersSig = tickers.join(",")` pattern in `GroupTab` prevents re-fetching when a new array reference with the same content is passed. `sessionStorage` sub-tab persistence restores state on remount.
- **Related files:** `frontend/app/components/GroupTab.tsx` → `tickersSig`, `fetchData` callback

---

### Bug: Rename Double API Call (Enter + Blur)

- **Problem:** Renaming a group by pressing Enter triggered two API calls: one from the `onKeyDown` handler and one from the `onBlur` handler (focus lost after Enter).
- **Root cause:** Both `onKeyDown` (Enter) and `onBlur` were wired to `handleRenameGroup()`. Enter fires the handler and removes focus, triggering blur, which fires again.
- **Fix:** `renameEscRef` flag in `page.tsx`. On Escape: set `renameEscRef.current = true` before clearing `renamingGroup`. On blur: check the flag and skip the save call; reset the flag.
- **Prevention:** Do not remove `renameEscRef`. Do not simplify rename to only `onKeyDown` (users expect blur-to-confirm).
- **Related files:** `frontend/app/page.tsx` → `renameEscRef`, `handleRenameGroup()`

---

### Bug: Chart Bubbles / Bars Clipping at SVG Boundary

- **Problem:** In `PnLChart`, large bubble circles (radius ~62px for large positions) were visually cut off at the chart edge. Waterfall bar value labels were also clipped at the Y-axis max.
- **Root cause:** Recharts `"auto"` domain places data points exactly at axis bounds. Elements with radius or extending labels overflow the SVG boundary.
- **Fix:** Manual domain calculation with explicit padding: bubble chart xPad=0.30, yPad=0.50; waterfall Y-axis +20%; bar chart X-axis +25%. Chart height increased (340→400px for bubble). Margins increased (top/bottom 48/24→72/72).
- **Prevention:** Do not revert to Recharts `"auto"` domain. Do not reduce padding constants.
- **Related files:** `frontend/app/components/PnLChart.tsx` → `BubbleChart`, `WaterfallChart`, `BarChartView`

---

### Bug: Recharts Tooltip Text Invisible on Dark Theme

- **Problem:** Waterfall / bar chart tooltips showed black text on a dark background (invisible).
- **Root cause:** Recharts default tooltip background is white; custom tooltip label color defaulted to system black. Dark theme background was dark → black text invisible.
- **Fix:** Custom tooltip component with explicit colors: teal label, light text (`var(--text)`), semi-transparent dark background.
- **Prevention:** All Recharts tooltips must use explicit color styling. Do not rely on Recharts default tooltip styles.
- **Related files:** `frontend/app/components/PnLChart.tsx` → custom tooltip components

---

### Bug: TW Market Status Showing Wrong Sub-tab

- **Problem:** Creating a TW watchlist group showed "US" market indicator instead of "TW".
- **Root cause:** `markets` state in `page.tsx` was initialized from `api.groups()` response, but the `createGroup` handler was only merging the new group's market with the existing markets using the wrong key.
- **Fix:** Defensive merge pattern: `setMarkets(prev => ({ ...prev, ...(res.markets ?? { [name]: market }) }))` — spreads the full response markets first, falls back to inserting just the new entry.
- **Related files:** `frontend/app/page.tsx` → `handleCreateGroup()`

---

### Bug: `GME-WT` P&L Data Always Empty

- **Problem:** GME-WT (GameStop warrant) showed null price/pct in portfolio P&L despite being a valid Yahoo Finance ticker.
- **Root cause (1):** `_portfolio_rows()` was computing `unreal_gain` only when `pct` was not None. For sparse tickers that yfinance returns with only 1 daily bar (no previous day), `pct` is None → `unreal_gain` also None.
- **Root cause (2):** `yf.download(period="5d")` returned only 1 bar for GME-WT → couldn't compute pct (requires 2 bars to calculate change).
- **Fix:** `unreal_gain` and `pct` are now computed independently. Sparse ticker fallback: `yf.Ticker(t).fast_info.get("previousClose")` used when only 1 daily bar available.
- **Related files:** `backend/main.py` → `_portfolio_rows()`, `_fetch_quotes()`
- **Verification:** GME-WT shows price, today_gain, unreal_gain in P&L table after fix.

---

### Bug: FastAPI Route Conflict (`/accounts/order` matched by `/{account}/order`)

- **Problem:** `PUT /api/portfolio/accounts/order` was returning 422 or routing to the wrong handler.
- **Root cause:** FastAPI matches routes in definition order. `PUT /api/portfolio/{account}/order` was defined before `PUT /api/portfolio/accounts/order`. FastAPI matched the literal string "accounts" as the `{account}` path parameter.
- **Fix:** Define `PUT /api/portfolio/accounts/order` **before** `PUT /api/portfolio/{account}/order` in `main.py`.
- **Prevention:** Any new routes with a fixed segment where a parameterized route exists must be defined first. E.g., `/portfolio/accounts/X` must come before `/portfolio/{account}/X`.
- **Related files:** `backend/main.py` — route ordering near line ~1100

---

## Intentional Defensive Logic

### `_quotes_stale` — Permanent Fallback Cache

- **Location:** `backend/main.py`, global dict
- **Logic:** Every successful quote fetch updates `_quotes_stale[ticker] = row`. On batch fetch failure, `_fetch_quotes()` returns stale data for affected tickers.
- **Why it exists:** Network blips and rate limits are transient. Stale price is more useful than null.
- **What not to change:** Do not remove, do not replace with a short-TTL cache.

---

### Single Batch `yf.download()` in `_fetch_quotes()`

- **Location:** `backend/main.py` → `_fetch_quotes()`
- **Logic:** Collects all cache misses, fetches in a single `yf.download(all_misses, ...)` call.
- **Why it exists:** Prevents Yahoo Finance rate limiting from per-ticker parallel requests.
- **What not to change:** Do not split into multiple downloads, do not use ThreadPoolExecutor.

---

### TW_EXCHANGE Static Lookup in `_resolve_tw_ticker()`

- **Location:** `backend/main.py` → `_resolve_tw_ticker()`, `backend/tw_exchange.py`
- **Logic:** Check dict first. Only call yfinance if code not in dict.
- **Why it exists:** Rate-limited yfinance calls returned wrong exchange for known TWSE stocks.
- **What not to change:** Do not remove dict lookup. Do not make the yfinance path the primary resolution.

---

### Migration Idempotency Guards

- **Location:** `backend/main.py` → `_migrate_v1()`, `_migrate_v2()`
- **Logic:** Each migration uses `if "key" not in data` before adding fields.
- **Why it exists:** Ensures running migrations twice produces the same result. Prevents overwriting user-modified data on repeated startup.
- **What not to change:** Never use unconditional assignment in migrations.

---

### `_require_real_mode()` in All Write Endpoints

- **Location:** `backend/main.py`, called at top of every POST/PUT/DELETE handler
- **Logic:** Raises HTTP 403 if `use_mock=True`. Must be first line of handler.
- **Why it exists:** Frontend disabled state can be bypassed; backend must be the real guard.
- **What not to change:** Do not remove from any write endpoint. Do not add new write endpoints without it.

---

### `settingsLoaded` Gate in `page.tsx`

- **Location:** `frontend/app/page.tsx`
- **Logic:** `{settingsLoaded && <TabContent ... />}` — nothing renders until `api.getSettings()` returns.
- **Why it exists:** Prevents real data flash in demo mode on page reload.
- **What not to change:** Do not move settings loading to individual components.

---

### `tickersSig = tickers.join(",")` in `GroupTab.tsx`

- **Location:** `frontend/app/components/GroupTab.tsx`
- **Logic:** Uses string join as a stable dependency for `useCallback` instead of the array reference.
- **Why it exists:** Parent component (`page.tsx`) passes a new array reference on every countdown tick (re-render). Without the join trick, `fetchData` would re-run every second.
- **What not to change:** Do not replace with `tickers` as dependency directly.

---

### Manual Chart Domain Padding in `PnLChart.tsx`

- **Location:** `frontend/app/components/PnLChart.tsx`
- **Logic:** Domain = `[min - pad, max + pad]` with specific padding constants per chart type.
- **Why it exists:** Recharts `"auto"` clips elements at SVG boundary.
- **What not to change:** Do not reduce padding constants or revert to `"auto"`.

---

### `renameEscRef` in `page.tsx`

- **Location:** `frontend/app/page.tsx`
- **Logic:** Set to `true` on Escape keydown; `onBlur` handler checks and skips save; resets after.
- **Why it exists:** Prevents double API call when Enter commits rename (Enter → handler fires → input blurs → blur handler fires again).
- **What not to change:** Do not remove or simplify this ref.

---

### Optimistic Update in `handleReorderAccounts()`

- **Location:** `frontend/app/components/PortfolioTab.tsx`
- **Logic:** Update local `portfolio` state first, then call `api.reorderAccounts()` async. On failure: revert via `loadPortfolio()`.
- **Why it exists:** Without optimistic update, the tab bar snaps back during the ~200ms API call.
- **What not to change:** Do not await the API call before updating state.
