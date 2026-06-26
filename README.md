# ◈ Stock Dashboard

美股與台股即時漲跌幅儀表板，深色科技風 UI，支援多帳戶持倉損益追蹤、多組股票、多種圖表，每 30 秒自動更新。

---

## 功能特色

| 功能 | 說明 |
|------|------|
| 💼 多帳戶持倉 | 複委託台幣戶、複委託美金戶、台股帳戶各自獨立管理 |
| 📊 整體損益 | 美股兩帳戶分群顯示，合計總損益列；台股獨立顯示 |
| 💰 今日損益 | 單股漲跌金額與%、今日損益、未實現損益 |
| 📈 多種圖表 | 氣泡圖 / 瀑布圖 / 樹狀熱力圖 / 長條圖，可切換 |
| 📋 Cards | 每支股票顯示現價與當日漲跌幅 |
| 🥧 圓餅圖 | 依漲跌幅絕對值顯示各股佔比 |
| 📊 長條圖 | 橫向以 0% 為中心延伸，正規化顯示 |
| 🌅 盤前/後 | 1 分鐘即時報價（盤前 04:00、盤後 20:00 ET） |
| ↕ 自訂排序 | 股票群組與持倉皆可拖拉調整順序，永久儲存 |
| ✅ 代號驗證 | 新增前自動驗證 yfinance 是否存在該代號 |
| 🇹🇼 台股自動後綴 | 輸入純代號（如 2330），自動識別上市(.TW)/上櫃(.TWO) |
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

## 安裝步驟

### macOS

**1. 確認 Python 版本**

```bash
python3 --version
```

若尚未安裝 Python，請至 [python.org](https://www.python.org/downloads/) 下載，或使用 Homebrew：

```bash
brew install python
```

**2. 安裝相依套件**

```bash
pip3 install streamlit yfinance plotly pandas pytz streamlit-autorefresh streamlit-sortables
```

**3. 啟動儀表板**

```bash
cd ~/Desktop/stock-dashboard
streamlit run stock_dashboard.py
```

---

### Windows

**1. 確認 Python 版本**

```powershell
python --version
```

若尚未安裝，請至 [python.org](https://www.python.org/downloads/) 下載，安裝時勾選 **「Add Python to PATH」**。

**2. 安裝相依套件**

```powershell
pip install streamlit yfinance plotly pandas pytz streamlit-autorefresh streamlit-sortables
```

**3. 啟動儀表板**

```powershell
cd Desktop\stock-dashboard
streamlit run stock_dashboard.py
```

---

## 建議：使用虛擬環境（選用）

**macOS**

```bash
python3 -m venv venv
source venv/bin/activate
pip install streamlit yfinance plotly pandas pytz streamlit-autorefresh streamlit-sortables
streamlit run stock_dashboard.py
```

**Windows**

```powershell
python -m venv venv
venv\Scripts\activate
pip install streamlit yfinance plotly pandas pytz streamlit-autorefresh streamlit-sortables
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
4. 點 **↕ 調整持倉順序 ▼** 可拖拉調整持倉顯示順序
5. 所有資料儲存於本地 `config.json`，重啟後自動載入

### 今日損益

- **單股漲跌**：`現價 − 昨收`（金額與 %）
- **今日損益**：`(現價 − 昨收) × 股數`（不涉及成本）
- **未實現損益**：`(現價 − 平均成本) × 股數`
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

| 套件 | 用途 |
|------|------|
| `streamlit` | Web UI 框架 |
| `yfinance` | Yahoo Finance 資料抓取 |
| `plotly` | 圓餅圖、長條圖、氣泡圖、瀑布圖、樹狀圖 |
| `pandas` | 資料處理 |
| `pytz` | 時區轉換（美東時間） |
| `streamlit-autorefresh` | 每 30 秒自動重跑頁面 |
| `streamlit-sortables` | 拖拉排序元件 |

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
