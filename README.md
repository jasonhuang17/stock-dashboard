# ◈ Stock Dashboard

美股即時漲跌幅儀表板，深色科技風 UI，支援個人持倉損益追蹤、多組股票、圓餅圖、長條圖，每 30 秒自動更新。

---

## 功能特色

| 功能 | 說明 |
|------|------|
| 💼 持倉管理 | 新增股票、股數、平均成本，計算今日與未實現損益 |
| 💰 今日損益 | 條列每支持股今日漲跌金額、單股漲跌、氣泡圖視覺化 |
| 📋 Cards | 每支股票顯示現價與當日漲跌幅 |
| 🥧 圓餅圖 | 依漲跌幅絕對值顯示各股佔比，每股不同色 |
| 📊 長條圖 | 橫向以 0% 為中心延伸，正規化顯示讓微小變化也清晰可見 |
| 🌅 盤前/後 | 1 分鐘即時報價（含盤前 04:00、盤後 20:00 ET） |
| ↕ 自訂排序 | Cards 可依漲幅、代號、價格排序，支援拖拉自訂順序並永久儲存 |
| ↻ 自動更新 | 每 30 秒重新抓取資料，倒數秒數即時顯示（自訂排序模式暫停） |
| 台灣慣例 | 紅色 = 上漲，綠色 = 下跌 |

**預設股票分組**

- 🚀 個股：AAOI、ONDS、MU、SNDK、SPCX、TSLA、NVDA、TSM、AAPL、GOOG、AMZN
- ⚡ 槓桿型：AAOX、ONDL、MUU、SNXX、TSMX
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

1. 點選 **💼 持倉** Tab → **📝 持倉管理**
2. 輸入股票代號、股數（整數）、平均成本（三位小數）後點 **新增**
3. 點 **編輯** 可修改股數或成本，點 **刪除** 移除
4. 所有資料儲存於本地 `config.json`，重啟後自動載入

### 今日損益

- **單股漲跌**：`現價 − 昨收`（金額與 %）
- **今日損益**：`(現價 − 昨收) × 股數`（不涉及成本）
- **未實現損益**：`(現價 − 平均成本) × 股數`
- **氣泡圖**：X 軸 = 今日漲跌%、Y 軸 = 今日損益金額、氣泡大小 = 持倉市值

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
- 個人持倉（股票代號、股數、平均成本）

此檔案已加入 `.gitignore`，不會被 commit 至 Git。

---

## 相依套件

| 套件 | 用途 |
|------|------|
| `streamlit` | Web UI 框架 |
| `yfinance` | Yahoo Finance 資料抓取 |
| `plotly` | 圓餅圖、長條圖、氣泡圖 |
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

**Q：持倉資料重啟後消失？**
確認 `config.json` 在專案資料夾內（`stock-dashboard/config.json`）。

**Q：如何停止儀表板？**
在 Terminal / PowerShell 按 `Ctrl + C`。

---

## 作者

Made by **Jason Huang** · 2026
