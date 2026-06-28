# ◈ Stock Dashboard

美股與台股即時漲跌幅儀表板，深色科技風 UI，支援多帳戶持倉損益追蹤、多組股票、多種圖表，每 30 秒自動更新。

**JS 版本**：FastAPI backend + Next.js frontend，完整 Web 應用體驗

---

## 功能特色

| 功能 | 說明 |
|------|------|
| 💼 多帳戶持倉 | 動態帳戶管理：可新增、重命名、刪除帳戶；幣別 USD/TWD 各自獨立 |
| 📊 整體損益 | 按幣別動態分組顯示，合計總損益列 |
| 💰 今日損益 | 單股漲跌金額與%、今日損益、未實現損益；11+ 可選欄位（52W最高/最低/YTD/成交量等），拖曳排序，垂直分隔線，設定永久儲存；欄位標題 hover 顯示說明 |
| 🌙 盤後損益 | 帳戶今日損益下方可展開盤後/前損益 table（收盤價 / 盤後價 / 漲跌 / 損益） |
| 📈 多種圖表 | 氣泡圖 / 瀑布圖 / 樹狀熱力圖 / 長條圖，可切換今日損益或未實現損益 |
| 📉 K 線頁面 | 點擊任一代號進入 `/stock/[ticker]`，1d/1w/1m/3m/YTD/1y/5y/all 顆粒度，含成交量 |
| 🌐 市場總覽 | 📈 市場 tab：US 市場即時漲幅/跌幅/成交量前 25 名（Yahoo Finance 全市場 Screener）；TW 熱門股票排序 |
| ₿ 加密貨幣 | 15 幣種卡片 + 表格，排序切換 |
| 📋 Cards | 每支股票顯示現價與當日漲跌幅 |
| 🥧 圓餅圖 | 依漲跌幅絕對值顯示各股佔比 |
| 📊 長條圖 | 橫向以 0% 為中心延伸，正規化顯示 |
| 🌅 盤前/後 | 1 分鐘即時報價（盤前 04:00、盤後 20:00 ET） |
| ↕ 自訂排序 | 股票群組與持倉皆可拖拉調整順序，永久儲存 |
| ✅ 代號驗證 | 新增前自動驗證 yfinance 是否存在該代號（US 驗美股，TW 驗台股） |
| 🌏 市場分類 | 每個觀察清單可指定 US 或 TW 市場；建立時選擇，TW 清單自動使用台股代號格式 |
| 🕐 雙時區時間 | Header 同時顯示 ET（美東）與台北時間及開盤狀態 |
| 🇹🇼 台股自動後綴 | 輸入純代號（如 2330），自動識別上市(.TW)/上櫃(.TWO) |
| 🈶 台股中文名稱 | 台股帳戶代號旁自動顯示中文名稱（如「2330 台積電」），所有表格與圖表皆適用 |
| ↻ 自動更新 | 每 30 秒重新抓取，倒數秒數即時顯示 |
| 台灣慣例 | 紅色 = 上漲，綠色 = 下跌 |

**預設股票分組（Demo 模式）**

- ⚡ 個股：AAPL、MSFT、NVDA、TSLA、AMZN、GOOGL、META、NFLX、AMD、AVGO、TSM、QCOM、MU、INTC、CRM、ADBE、ORCL、SHOP、UBER、ABNB
- 🚀 槓桿型：TQQQ、SQQQ、UPRO、SPXU、SOXL、SOXS、TECL、LABU、FNGU、CURE
- 🌐 大盤型：VOO、SPY、QQQ、IWM、DIA、VTI、GLD、TLT、BND、AGG

> 資料來源：Yahoo Finance（日線約延遲 15 秒；盤前/後使用 1 分鐘線）

---

## 安裝與啟動

### Windows

#### 第一步：安裝必要環境（只需做一次）

**1. 安裝 Python**

1. 前往 https://www.python.org/downloads/
2. 點擊 **Download Python 3.x.x**（最新版）
3. 執行安裝檔
4. ⚠️ 安裝畫面第一頁，務必勾選 **"Add Python to PATH"**，再點 Install Now
5. 安裝完成後，開啟命令提示字元（Win+R → 輸入 `cmd` → Enter），輸入 `python --version`，看到版本號代表成功

**2. 安裝 Node.js**

1. 前往 https://nodejs.org/
2. 點擊 **LTS** 版本下載（推薦，較穩定）
3. 執行安裝檔，全部選預設值，一直點 Next 即可
4. 安裝完成後，在命令提示字元輸入 `node --version`，看到版本號代表成功

---

#### 第二步：啟動儀表板

**雙擊 `start-windows.bat`**（在專案根目錄）

腳本會自動完成以下步驟：

| 步驟 | 說明 | 時間 |
|------|------|------|
| 檢查 Python / Node.js | 若未安裝會顯示說明並停止 | 立即 |
| 安裝 Python 套件 | 僅**首次**執行需要，之後跳過 | 1–2 分鐘 |
| 安裝 Node 套件 | 僅**首次**執行需要，之後跳過 | 1–3 分鐘 |
| 啟動 Backend :8000 | 開啟獨立的命令視窗 | 立即 |
| 啟動 Frontend :3000 | 開啟獨立的命令視窗，首次需編譯 | 15–30 秒 |
| 開啟瀏覽器 | 自動開啟 http://localhost:3000 | 自動 |

> **瀏覽器開啟後顯示空白或錯誤？** 這是 Frontend 還在編譯中，等 15–30 秒後重新整理頁面即可。

---

#### 日常使用

- **啟動**：雙擊 `start-windows.bat`，約 5 秒後瀏覽器自動開啟
- **停止**：關閉「Backend :8000」和「Frontend :3000」兩個命令視窗
- **重新整理資料**：瀏覽器按 F5，或等每 30 秒自動更新

---

#### 常見問題（Windows）

**Port 已被佔用（上次沒有正確關閉）**

開啟 PowerShell，執行：

```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 8000).OwningProcess -Force
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess -Force
```

執行完畢後再雙擊 `start-windows.bat` 重新啟動。

**`python` 指令找不到**

安裝 Python 時沒有勾選 "Add Python to PATH"。解決方式：
- 重新執行 Python 安裝檔 → 選 **Modify** → 勾選 **Add Python to environment variables** → 儲存
- 或在命令提示字元改用 `py` 取代 `python`（部分 Windows 版本適用）

**防火牆詢問是否允許存取**

點擊**允許存取**，這是 Python（FastAPI）和 Node.js 要在本機監聽 port 的正常請求，不會對外開放。

---

### macOS / Linux

**1. 安裝 backend 相依套件**

```bash
cd ~/Desktop/stock-dashboard/js/backend
pip3 install -r requirements.txt
```

**2. 安裝 frontend 相依套件**

```bash
cd ~/Desktop/stock-dashboard/js/frontend
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
cd js/backend && uvicorn main:app --port 8000 --reload

# Terminal 2
cd js/frontend && npm run dev
```

瀏覽器開啟 `http://localhost:3000`（frontend）或 `http://localhost:8000/docs`（API 文件）。

**Port 已被佔用**

```bash
lsof -ti tcp:8000 -ti tcp:3000 | xargs kill -9 2>/dev/null; ./start-js.sh
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
5. 所有資料儲存於本地 `user_data.json`，重啟後自動載入

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

啟動後會在專案目錄自動產生 `user_data.json`，儲存：

- 各分組的股票清單與顯示順序
- 三個帳戶的持倉（股票代號、股數、平均成本）

此檔案已加入 `.gitignore`，不會被 commit 至 Git。

---

## 相依套件

### Backend

| 套件 | 用途 |
|------|------|
| `fastapi` | REST API 框架 |
| `uvicorn` | ASGI server |
| `yfinance` | Yahoo Finance 資料抓取 |
| `pandas` | 資料處理 |
| `pytz` | 時區轉換 |
| `cachetools` | thread-safe TTL Cache |

### Frontend

| 套件 | 用途 |
|------|------|
| `next` 15 | React App Router 框架 |
| `typescript` | 型別安全 |
| `tailwindcss` v4 | 樣式 |
| `recharts` | 圖表（氣泡/瀑布/樹狀/長條） |
| `@dnd-kit/*` | 拖拉排序 |

---

## 常見問題

**Q：所有股票顯示 `N/A`？**
可能是網路問題或 Yahoo Finance 暫時限流，等 30 秒後自動重試，或點右上角 **↻ REFRESH**。

**Q：台股代號顯示 N/A？**
確認代號正確（如 `2330`、`00981A`）。系統會自動試 `.TW` 與 `.TWO`，首次載入需幾秒解析。

**Q：持倉資料重啟後消失？**
確認 `user_data.json` 在 `stock-dashboard/js/user_data.json`。

**Q：如何停止儀表板？**
- **Windows**：關閉「Backend :8000」和「Frontend :3000」兩個命令視窗
- **macOS / Linux**：在 Terminal 按 `Ctrl + C`

---

## 作者

Made by **Jason Huang** · 2026
