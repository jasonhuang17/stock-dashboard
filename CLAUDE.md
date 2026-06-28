# Stock Dashboard — Claude Instructions

## AI Agent 進入點

**建議閱讀順序（由上至下）：**

1. **本檔案**（`CLAUDE.md`）— 開發規範、啟動方式、快速架構摘要
2. **`DEV_LOG.md`**（本地，gitignored）— 完整功能清單、所有變更紀錄、待辦清單
3. **`docs/AI_DEV_CONTEXT.md`**（本地，gitignored）— 完整架構說明：後端 API 路由、快取設計、前端元件結構、資料流
4. **`docs/DESIGN_DECISIONS.md`**（本地，gitignored）— 關鍵設計決策與不能隨意更動的理由
5. **`docs/REGRESSION_NOTES.md`**（本地，gitignored）— 歷史 bug、修復方式、防守性邏輯清單

---

## 啟動方式（JS 版本）

```bash
cd ~/Desktop/stock-dashboard
./start-js.sh          # 同時啟動 backend :8000 + frontend :3000
```

或分開啟動：

```bash
# Terminal 1（backend）
cd js/backend && uvicorn main:app --port 8000 --reload

# Terminal 2（frontend）
cd js/frontend && npm run dev
```

瀏覽器開 `http://localhost:3000`（前端）或 `http://localhost:8000/docs`（API 文件）。

---

## 專案結構

```
stock-dashboard/
├── start-js.sh            # 一鍵啟動腳本（根目錄）
├── CLAUDE.md              # 本檔案（已 commit）
├── README.md              # 使用說明（已 commit）
├── DEV_LOG.md             # 開發紀錄（gitignored）
├── docs/                  # AI 輔助開發文件（gitignored，僅存本地）
│   ├── AI_DEV_CONTEXT.md
│   ├── DESIGN_DECISIONS.md
│   └── REGRESSION_NOTES.md
├── js/                   # JS 版本
│   ├── backend/
│   │   ├── main.py            # FastAPI 後端（~1400 行，所有 API + 業務邏輯）
│   │   ├── demo_data.json     # Demo 持倉資料（已 commit）
│   │   ├── tw_exchange.py     # 台股代號 → 交易所靜態對照表（~2340 筆）
│   │   ├── tw_names.py        # 台股代號 → 中文名稱靜態對照表（~5083 筆）
│   │   └── requirements.txt
│   ├── frontend/
│   │   ├── app/
│   │   │   ├── page.tsx               # 主頁（tabs、groups、header）
│   │   │   ├── layout.tsx             # Root layout + ThemeInitializer
│   │   │   ├── globals.css            # CSS 變數、utility classes
│   │   │   ├── stock/[ticker]/page.tsx  # K 線圖頁面
│   │   │   └── components/            # 所有 React 元件
│   │   └── lib/
│   │       ├── api.ts         # 型別化 API client
│   │       ├── types.ts       # 共用 TypeScript 介面
│   │       └── themes.ts      # 主題定義 + applyTheme()
│   └── user_data.json         # 使用者資料（schema v4，gitignored）
└── py/                    # Python 版本（全部 gitignored，僅存本地，不再維護）
    ├── stock_dashboard.py
    ├── config.json
    └── README_streamlit.md
```

---

## 架構摘要

- **後端**：FastAPI（port 8000）+ yfinance，單一 `backend/main.py` 約 1400 行
- **前端**：Next.js 15 + TypeScript + Tailwind CSS v4（port 3000）
- **資料來源**：Yahoo Finance via `yfinance`，quotes 28 秒 cache
- **主色**：teal `#1ECFD6`、gold `#EDD170`、背景 `#001d3a`（9 種主題可切換）
- **顏色慣例**：紅色（`#C05640`）= 上漲，綠色（`#3DAA70`）= 下跌（台灣慣例）
- **持久化**：`user_data.json`，**目前格式（schema_version 4）**：
  ```json
  {
    "schema_version": 4,
    "group_tickers":  { "⚡ 個股": [...], "🚀 槓桿型": [...], "🌐 大盤型": [...] },
    "group_markets":  { "⚡ 個股": "US", "🚀 槓桿型": "US", "🌐 大盤型": "US" },
    "pinned_groups":  ["⚡ 個股", "🚀 槓桿型", "🌐 大盤型"],
    "portfolio": {
      "美股複委託（台幣帳戶）": { "currency": "USD", "positions": { "AAPL": { "shares": 10, "avg_cost": 150.0 } } },
      "台股帳戶":               { "currency": "TWD", "positions": { "2330": { "shares": 1000, "avg_cost": 500.0 } } }
    },
    "settings": { "use_mock": false, "crypto_tickers": ["BTC-USD", "ETH-USD", "..."], "account_groups": [{ "name": "主要帳戶", "accounts": ["美股複委託（台幣帳戶）"] }] }
  }
  ```
- **台股代號**：純代號存檔（`2330`，不含 `.TW`），`_resolve_tw_ticker()` 在 fetch 時自動查靜態對照表，再試 `.TW` → `.TWO`
- **Demo 模式**：後端所有 write endpoint 在 `use_mock=true` 時回 HTTP 403；前端同步 disable write UI

---

## 開發規範（必須遵守）

1. **Commit 訊息一律英文，且不得包含任何中文字、emoji 或非 ASCII 字元**，不加 `Co-Authored-By: Claude`
2. **每次更新 code 必須同步更新 `README.md`**（功能說明、使用步驟）
3. **每次 commit 必須在 `DEV_LOG.md` 的變更紀錄區補上條目**
4. Git 作者統一使用 `jasonhuang17 <jasonh6208work@gmail.com>`（repo 已設定，不需額外設定）
5. Push 前確認 `user_data.json` 不在 staging（已 gitignored，通常自動排除）
6. **更改 `user_data.json` 格式時，必須同步新增 migration**（見下方「資料格式版本管理」）

### Commit 前必做 Checklist（每次，無例外）

每一個 commit **之前**，必須依序完成：

```
[ ] 1. DEV_LOG.md → 在「變更紀錄」區最頂端新增條目，說明這次改了什麼、為什麼
[ ] 2. README.md  → 如有新增/修改功能，更新功能表格或說明（純 bugfix 可免）
[ ] 3. 確認沒有把 user_data.json / DEV_LOG.md 加入 staging
[ ] 4. git commit（英文訊息，無中文、emoji、Co-Authored-By）
```

**DEV_LOG.md 雖然 gitignored（不進 repo），但每次仍必須在本地更新。**
這是唯一的完整變更紀錄，略過等於永久遺失紀錄。

過去曾發生的錯誤模式（避免重蹈）：
- ❌ commit 完才想到要更新文檔，或根本忘記更新
- ❌ 連續數個 commit 都沒更新，最後一次補齊但細節已失真
- ❌ 只更新 DEV_LOG 沒更新 README（或反過來）

---

## 資料格式版本管理

**原則**：任何改動 `user_data.json` 結構的功能（新增欄位、重命名、刪除、型別改變），都必須同步新增 migration，否則舊版用戶升級後資料會壞掉。

### 版本對照

| schema_version | 對應 app 版本 | 主要改動 |
|---|---|---|
| 0（無此欄位） | 初始版 | 各種舊格式 |
| 1 | app v1（origin/master） | 多帳戶 portfolio、圖標重命名 |
| 2 | app v2 | 新增 `group_markets` |
| 3 | app v3 | 新增 `settings.crypto_tickers`（自訂加密貨幣觀察清單） |
| 4 | app v4（當前） | 新增 `settings.account_groups`（整體損益帳號自訂分組） |

### 新增 migration 的步驟（必須全部完成）

```python
# backend/main.py

# 1. 新增 migration 函式
def _migrate_v3(data: dict) -> dict:
    """一句話說明這個版本改了什麼."""
    # 修改 data 結構，保持向後相容
    return data

# 2. 註冊到 _MIGRATIONS dict
_MIGRATIONS: dict = {1: _migrate_v1, 2: _migrate_v2, 3: _migrate_v3}

# 3. Bump SCHEMA_VERSION
SCHEMA_VERSION = 3
```

4. 更新 CLAUDE.md 的「架構摘要」區塊，把 `user_data.json` 格式範例和版本對照表更新到最新
5. 在 DEV_LOG.md 記錄這次格式變更的內容

### Migration 的注意事項

- Migration 函式必須是**冪等的**（跑兩次結果相同）
- 用 `if "new_key" not in data` 防呆，不要無條件覆寫
- 不要刪除欄位（只新增或轉換），避免降版問題
- Migration 在 `load_config()` 的第一行呼叫，用戶完全無感知

---

## 關鍵後端函式（`js/backend/main.py`）

| 函式 | 說明 |
|------|------|
| `load_config()` / `save_config()` | 讀寫 user_data.json，thread-safe（`_config_lock`） |
| `load_settings()` / `save_settings()` | 讀寫 settings 子字典 |
| `_fetch_quotes(tickers)` | 批次日線報價，28 秒 TTLCache，**單一** `yf.download()` 呼叫 |
| `_fetch_52w_batch(tickers)` | 背景 daemon thread 抓 52W 高低（period="1y"），3600 秒 cache |
| `_fetch_ytd_batch(tickers)` | 批次 YTD 起始價，86400 秒 cache |
| `_fetch_premarket(tickers)` | 盤前/後 1 分鐘線，60 秒 cache |
| `_resolve_tw_ticker(bare)` | 台股代號 resolve：靜態對照表 → yfinance fallback，3600 秒 cache |
| `_strip_tw_suffix(ticker)` | 存檔前移除 .TW/.TWO 後綴 |
| `_ticker_exists(ticker)` | 驗證美股代號（300 秒 cache） |
| `_ticker_exists_tw(bare)` | 驗證台股代號（試 TW_EXCHANGE → yfinance）（300 秒 cache） |
| `_portfolio_rows(acct_key)` | 帳戶損益計算：取持倉 → resolve TW → 批次 fetch → 計算各欄 |
| `_require_real_mode()` | Demo 模式防寫：`use_mock=True` 時 raise HTTP 403 |
| `run_migrations(data)` | 升級 user_data.json 到最新 schema |
| `active_portfolio()` | 依 `use_mock` 回傳 real 或 demo 持倉 |
| `_fetch_screener(scr_id)` | Yahoo Finance screener API（day_gainers 等）via urllib.request |
