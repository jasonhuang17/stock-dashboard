# Stock Dashboard — Claude Instructions

## 開發脈絡

開始前請先讀 `DEV_LOG.md`（本地存在，gitignored）— 裡面有完整功能清單、架構說明與變更紀錄。

---

## 啟動方式

```bash
cd ~/Desktop/stock-dashboard
streamlit run stock_dashboard.py
```

瀏覽器開 `http://localhost:8501`。

---

## 專案結構

```
stock_dashboard.py        # Streamlit 版本（單一 Python 檔）
user_data.json            # 使用者資料（gitignored）：group_tickers + portfolio
backend/demo_data.json    # Demo 模式資料（已 commit）：55 支股票的範例持倉
DEV_LOG.md                # 開發紀錄（gitignored）
README.md                 # 使用說明（已 commit）
CLAUDE.md                 # 本檔案（已 commit）
```

---

## 架構摘要

- **單一 Python 檔**：`stock_dashboard.py`，約 1500 行，無額外模組
- **資料來源**：`yfinance`，30 秒 cache（`@st.cache_data(ttl=28)`）
- **UI 框架**：Streamlit，深色科幻主題，Courier New 字型
- **主色**：teal `#1ECFD6`、gold `#EDD170`、背景 `#001d3a`
- **持久化**：`user_data.json`，**目前格式（schema_version 2）**：
  ```json
  {
    "schema_version": 2,
    "group_tickers":  { "⚡ 個股": [...], "🚀 槓桿型": [...], "🌐 大盤型": [...] },
    "group_markets":  { "⚡ 個股": "US", "🚀 槓桿型": "US", "🌐 大盤型": "US" },
    "pinned_groups":  ["⚡ 個股", "🚀 槓桿型", "🌐 大盤型"],
    "portfolio": {
      "美股複委託（台幣帳戶）": { "currency": "USD", "positions": { "AAPL": { "shares": 10, "avg_cost": 150.0 } } },
      "美股複委託（美金帳戶）": { "currency": "USD", "positions": {} },
      "台股帳戶":               { "currency": "TWD", "positions": { "2330": { "shares": 1000, "avg_cost": 500.0 } } }
    },
    "settings": { "use_mock": false }
  }
  ```
- **台股代號**：純代號存檔（`2330`，不含 `.TW`），`_resolve_tw_ticker()` 在 fetch 時自動試 `.TW` → `.TWO`
- **顏色慣例**：紅色（`#C05640`）= 上漲，綠色（`#3DAA70`）= 下跌（台灣慣例）

---

## 開發規範（必須遵守）

1. **Commit 訊息一律英文，且不得包含任何中文字、emoji 或非 ASCII 字元**，不加 `Co-Authored-By: Claude`
2. **每次更新 code 必須同步更新 `README.md`**（功能說明、使用步驟）
3. **每次 commit 必須在 `DEV_LOG.md` 的變更紀錄區補上條目**
4. Git 作者統一使用 `jasonhuang17 <jasonh6208work@gmail.com>`（repo 已設定，不需額外設定）
5. Push 前確認 `config.json` 不在 staging（已 gitignored，通常自動排除）
6. **更改 `user_data.json` 格式時，必須同步新增 migration**（見下方「資料格式版本管理」）

---

## 資料格式版本管理

**原則**：任何改動 `user_data.json` 結構的功能（新增欄位、重命名、刪除、型別改變），都必須同步新增 migration，否則舊版用戶升級後資料會壞掉。

### 版本對照

| schema_version | 對應 app 版本 | 主要改動 |
|---|---|---|
| 0（無此欄位） | 初始版 | 各種舊格式 |
| 1 | app v1（origin/master） | 多帳戶 portfolio、圖標重命名 |
| 2 | app v2（當前） | 新增 `group_markets` |

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

## 關鍵函式

| 函式 | 說明 |
|------|------|
| `load_config()` / `save_config()` | 讀寫 config.json |
| `fetch_quotes(tickers)` | 批次抓日線報價，28 秒 cache |
| `fetch_premarket(tickers)` | 抓盤前/後 1 分鐘線，60 秒 cache |
| `_resolve_tw_ticker(bare)` | 台股代號 resolve（.TW/.TWO），300 秒 cache |
| `_ticker_exists(ticker)` | 驗證美股代號是否存在 |
| `_ticker_exists_tw(bare)` | 驗證台股代號是否存在（試 .TW/.TWO） |
| `_portfolio_rows(acct_key)` | 取得帳戶持倉損益資料（含 TWD resolve） |
| `_render_pnl_table(rows, currency)` | 渲染損益列表，回傳 (today, prev_mv, unreal, has_data) |
| `_render_manage_tab(acct_key, currency)` | 渲染持倉管理 UI（新增/編輯/刪除/排序） |
| `_render_summary_bar(...)` | 渲染今日總損益彙總列 |
| `_render_pnl_chart(rows, currency, key_prefix)` | 渲染損益圖表（氣泡/瀑布/樹狀/長條切換） |
