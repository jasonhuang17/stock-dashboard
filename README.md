# ◈ Stock Dashboard

美股與台股即時漲跌幅儀表板，深色科技風 UI，支援多帳戶持倉損益追蹤、多組股票、多種圖表，每 30 秒自動更新。

**兩個版本，共用同一份 `config.json`：**
- **Streamlit 版本**：`stock_dashboard.py`，單檔 Python，5 秒啟動
- **JS 版本**：FastAPI backend + Next.js frontend，適合作為獨立 Web 應用

---

## 功能特色

| 功能 | 說明 |
|------|------|
| 💼 多帳戶持倉 | 複委託台幣戶、複委託美金戶、台股帳戶各自獨立管理 |
| 📊 整體損益 | 美股兩帳戶分群顯示，合計總損益列；台股獨立顯示 |
| 💰 今日損益 | 單股漲跌金額與%、今日損益、未實現損益；可選顯示最高/最低/成交量（JS 版本存 localStorage） |
| 🌙 盤後損益 | JS 版本：帳戶今日損益下方可展開盤後/前損益 table（收盤價 / 盤後價 / 漲跌 / 損益） |
| 📈 多種圖表 | 氣泡圖 / 瀑布圖（合計欄顯示金額） / 樹狀熱力圖 / 長條圖，可切換 |
| 📋 Cards | 每支股票顯示現價與當日漲跌幅 |
| 🥧 圓餅圖 | 依漲跌幅絕對值顯示各股佔比 |
| 📊 長條圖 | 橫向以 0% 為中心延伸，正規化顯示 |
| 🌅 盤前/後 | 1 分鐘即時報價（盤前 04:00、盤後 20:00 ET） |
| ↕ 自訂排序 | 股票群組與持倉皆可拖拉調整順序，永久儲存 |
| ✅ 代號驗證 | 新增前自動驗證 yfinance 是否存在該代號 |
| 🇹🇼 台股自動後綴 | 輸入純代號（如 2330），自動識別上市(.TW)/上櫃(.TWO) |
| 🈶 台股中文名稱 | 台股帳戶代號旁自動顯示中文名稱（如「2330 台積電」），所有表格與圖表皆適用 |
| ↻ 自動更新 | 每 30 秒重新抓取，倒數秒數即時顯示 |
| 台灣慣例 | 紅色 = 上漲，綠色 = 下跌 |

**預設股票分組**

- 🚀 個股：AAOI、ONDS、MU、SNDK、SPCX、TSLA、NVDA、TSM、AAPL、GOOG、AMZN
- ⚡ 槓桿型：AAOX、ONDL、MUU、TSMX
- 🌐 大盤型：VOO、SPY、QQQ

> 資料來源：Yahoo Finance（日線約延遲 15 秒；盤前/後使用 1 分鐘線）

---

## 環境需求

- **Python 3.8 或以上**
- 網路連線（抓取 Yahoo Finance 資料）

---

## 安裝與啟動

### Streamlit 版本（推薦，快速啟動）

**macOS**

```bash
pip3 install streamlit yfinance plotly pandas pytz streamlit-sortables cachetools
cd ~/Desktop/stock-dashboard
streamlit run stock_dashboard.py
```

**Windows**

```powershell
pip install streamlit yfinance plotly pandas pytz streamlit-sortables cachetools
cd Desktop\stock-dashboard
streamlit run stock_dashboard.py
```

瀏覽器開啟 `http://localhost:8501`。

---

### JS 版本（FastAPI + Next.js）

需要：Python 3.8+、Node.js 20+

**1. 安裝 backend 相依套件**

```bash
cd ~/Desktop/stock-dashboard/backend
pip3 install -r requirements.txt
```

**2. 安裝 frontend 相依套件**

```bash
cd ~/Desktop/stock-dashboard/frontend
npm install
```

**3. 一鍵啟動兩個服務**

```bash
cd ~/Desktop/stock-dashboard
./start-js.sh
```

或分開啟動：

```bash
# Terminal 1
cd backend && uvicorn main:app --port 8000 --reload

# Terminal 2
cd frontend && npm run dev
```

瀏覽器開啟 `http://localhost:3000`（frontend）或 `http://localhost:8000/docs`（API 文件）。

---

## 建議：使用虛擬環境（Streamlit 版本，選用）

**macOS**

```bash
python3 -m venv venv
source venv/bin/activate
pip install streamlit yfinance plotly pandas pytz streamlit-sortables cachetools
streamlit run stock_dashboard.py
```

**Windows**

```powershell
python -m venv venv
venv\Scripts\activate
pip install streamlit yfinance plotly pandas pytz streamlit-sortables cachetools
streamlit run stock_dashboard.py
```

---

## 使用說明

### 持倉管理

1. 點選 **💼 持倉** Tab → 選擇帳戶（台幣戶 / 美金戶 / 台股帳戶）→ **📝 持倉管理**
2. 輸入股票代號、股數、平均成本後點 **新增**
   - 台股帳戶輸入純代號即可（如 `2330`），無須加 `.TW`
   - 系統會自動驗證代號是否存在，不合法代號無法新增
3. 點 **編輯** 可修改股數或成本，點 **刪除** 移除
   - 單股成本與總成本擇一填入即可，另一欄會在下方顯示 `≈ 計算值` 提示
   - 若兩欄都填，儲存前會驗證差距是否在 1% 以內
   - 填入**總成本**（實際買入金額）可提升未實現損益精度，避免小數截斷誤差
4. 點 **↕ 調整持倉順序 ▼** 可拖拉調整持倉顯示順序
5. 所有資料儲存於本地 `config.json`，重啟後自動載入

### 今日損益

- **單股漲跌**：`現價 − 昨收`（金額與 %）
- **今日總損益**：`(現價 − 昨收) × 股數`（不涉及成本）
- **未實現損益**：`(現價 × 股數) − 總成本`（有填總成本時）或 `(現價 − 平均成本) × 股數`
- **圖表切換**：氣泡圖 / 瀑布圖 / 樹狀熱力圖 / 長條圖

### 整體損益

- 美股顯示：台幣戶與美金戶各自列出，下方合計總損益
- 台股顯示：獨立區塊，幣別 TWD

### 自訂股票順序

1. 切換至任一組別的 **Cards** Tab
2. 排序選單選 **自訂順序**
3. 點 **↕ 調整排序順序 ▼** 展開拖拉清單
4. 拖拉後自動儲存，重啟仍保留

### 新增 / 移除股票

在 Cards Tab 展開 **＋ 編輯股票清單**，輸入代號新增，點 **✕** 移除。

---

## 本地設定檔

啟動後會在專案目錄自動產生 `config.json`，儲存：

- 各分組的股票清單與顯示順序
- 三個帳戶的持倉（股票代號、股數、平均成本）

此檔案已加入 `.gitignore`，不會被 commit 至 Git。

---

## 相依套件

### Streamlit 版本

| 套件 | 用途 |
|------|------|
| `streamlit` | Web UI 框架（含 `@st.fragment` 30 秒自動更新） |
| `yfinance` | Yahoo Finance 資料抓取 |
| `plotly` | 圓餅圖、長條圖、氣泡圖、瀑布圖、樹狀圖 |
| `pandas` | 資料處理 |
| `pytz` | 時區轉換（美東時間） |
| `streamlit-sortables` | 拖拉排序元件 |
| `cachetools` | TTL Cache（for `_resolve_tw_ticker` 等函式） |

### JS 版本 backend

| 套件 | 用途 |
|------|------|
| `fastapi` | REST API 框架 |
| `uvicorn` | ASGI server |
| `yfinance` | Yahoo Finance 資料抓取 |
| `pandas` | 資料處理 |
| `pytz` | 時區轉換 |
| `cachetools` | thread-safe TTL Cache |

### JS 版本 frontend

| 套件 | 用途 |
|------|------|
| `next` 15 | React App Router 框架 |
| `typescript` | 型別安全 |
| `tailwindcss` v4 | 樣式 |
| `recharts` | 圖表（氣泡/瀑布/樹狀/長條） |
| `@dnd-kit/*` | 拖拉排序 |

---

## 常見問題

**Q：啟動後瀏覽器沒有自動開啟？**
手動前往 `http://localhost:8501`。

**Q：顯示 `ModuleNotFoundError`？**
確認用相同的 `python` / `pip` 執行安裝與啟動，或改用虛擬環境。

**Q：所有股票顯示 `N/A`？**
可能是網路問題或 Yahoo Finance 暫時限流，等 30 秒後自動重試，或點右上角 **↻ REFRESH**。

**Q：台股代號顯示 N/A？**
確認代號正確（如 `2330`、`00981A`）。系統會自動試 `.TW` 與 `.TWO`，首次載入需幾秒解析。

**Q：持倉資料重啟後消失？**
確認 `config.json` 在專案資料夾內（`stock-dashboard/config.json`）。

**Q：如何停止儀表板？**
在 Terminal / PowerShell 按 `Ctrl + C`。

---

## 作者

Made by **Jason Huang** · 2026
