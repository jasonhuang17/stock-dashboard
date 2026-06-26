# ◈ Stock Dashboard

美股即時漲跌幅儀表板，深色科技風 UI，支援多組股票、圓餅圖、長條圖，每 30 秒自動更新。

---

## 功能特色

| 功能 | 說明 |
|------|------|
| 📋 Cards | 每支股票顯示現價與當日漲跌幅 |
| 🥧 圓餅圖 | 依漲跌幅絕對值顯示各股佔比，每股不同色 |
| 📊 長條圖 | 橫向以 0% 為中心延伸，正規化顯示讓微小變化也清晰可見 |
| ↻ 自動更新 | 每 30 秒重新抓取資料，倒數秒數即時顯示 |
| ＋ 編輯清單 | 可在 Cards 頁直接新增 / 移除股票代號 |
| 台灣慣例 | 紅色 = 上漲，綠色 = 下跌 |

**預設股票分組**

- 🚀 個股：AAOI、ONDS、MU、SNDK、SPCX、TSLA、NVDA、TSM、AAPL、GOOG、AMZN
- ⚡ 槓桿型：AAOX、ONDL、MUU、SNXX、TSMX
- 🌐 大盤型：VOO、SPY、QQQ

> 資料來源：Yahoo Finance（約延遲 15 秒）

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

開啟 Terminal，切換至專案資料夾後執行：

```bash
pip3 install streamlit yfinance plotly pandas pytz streamlit-autorefresh
```

若系統有多個 Python 環境，建議改用：

```bash
python3 -m pip install streamlit yfinance plotly pandas pytz streamlit-autorefresh
```

**3. 啟動儀表板**

```bash
streamlit run stock_dashboard.py
```

瀏覽器會自動開啟 `http://localhost:8501`。

---

### Windows

**1. 確認 Python 版本**

開啟 **命令提示字元（cmd）** 或 **PowerShell**，輸入：

```powershell
python --version
```

若尚未安裝 Python，請至 [python.org](https://www.python.org/downloads/) 下載安裝程式。  
安裝時請勾選 **「Add Python to PATH」**。

**2. 安裝相依套件**

```powershell
pip install streamlit yfinance plotly pandas pytz streamlit-autorefresh
```

若 `pip` 指令找不到，請改用：

```powershell
python -m pip install streamlit yfinance plotly pandas pytz streamlit-autorefresh
```

**3. 啟動儀表板**

```powershell
streamlit run stock_dashboard.py
```

瀏覽器會自動開啟 `http://localhost:8501`。

---

## 建議：使用虛擬環境（選用）

建議建立獨立虛擬環境，避免套件版本衝突。

**macOS**

```bash
python3 -m venv venv
source venv/bin/activate
pip install streamlit yfinance plotly pandas pytz streamlit-autorefresh
streamlit run stock_dashboard.py
```

**Windows**

```powershell
python -m venv venv
venv\Scripts\activate
pip install streamlit yfinance plotly pandas pytz streamlit-autorefresh
streamlit run stock_dashboard.py
```

---

## 使用說明

### 查看股票資料

啟動後，頁面頂端顯示：
- 市場狀態（`OPEN` / `PRE/POST` / `CLOSED`）
- 當前美東時間
- 下次資料更新倒數

點選三個外層 Tab（個股 / 槓桿型 / 大盤型）切換股票組別。  
每個組別內有三個子 Tab：Cards、圓餅圖、長條圖。

### 新增股票

1. 切換至任一組別的 **Cards** Tab
2. 展開 **「＋ 編輯股票清單」**
3. 輸入股票代號（例如 `META`），點擊 **新增**

### 移除股票

在編輯清單展開後，點擊代號旁的 **✕ 按鈕**即可移除。

> 注意：新增 / 移除後會立即重新整理，但編輯結果**不會**永久儲存，重新啟動程式後會還原預設清單。若要永久修改，請直接編輯 `stock_dashboard.py` 中的 `GROUPS` 常數。

---

## 自訂股票預設清單

開啟 `stock_dashboard.py`，找到以下段落修改：

```python
GROUPS = {
    "🚀 個股": ("AAOI", "ONDS", "MU", ...),
    "⚡ 槓桿型": ("AAOX", "ONDL", ...),
    "🌐 大盤型": ("VOO", "SPY", "QQQ"),
}
```

同時也更新下方的 `st.session_state.group_tickers` 初始值（兩處保持一致）。

---

## 相依套件版本參考

| 套件 | 用途 |
|------|------|
| `streamlit` | Web UI 框架 |
| `yfinance` | Yahoo Finance 資料抓取 |
| `plotly` | 圓餅圖、長條圖 |
| `pandas` | 資料處理 |
| `pytz` | 時區轉換（美東時間） |
| `streamlit-autorefresh` | 每 30 秒自動重跑頁面 |

若遇到套件相容問題，可固定版本安裝：

```bash
pip install streamlit>=1.32 yfinance>=0.2 plotly>=5.0 pandas>=2.0 pytz streamlit-autorefresh
```

---

## 常見問題

**Q：啟動後瀏覽器沒有自動開啟？**  
手動前往 `http://localhost:8501`。

**Q：顯示 `ModuleNotFoundError`？**  
代表該套件尚未安裝於當前 Python 環境。請確認用相同的 `python` / `pip` 執行安裝與啟動，或改用虛擬環境。

**Q：所有股票顯示 `N/A`？**  
可能是網路問題或 Yahoo Finance 暫時限流。等待 30 秒後會自動重試，或點擊右上角 **↻ REFRESH**。

**Q：資料是即時的嗎？**  
Yahoo Finance 免費 API 約有 15 秒延遲。App 每 30 秒重新抓取一次，並在本地快取 28 秒。

**Q：如何停止儀表板？**  
在 Terminal / PowerShell 中按 `Ctrl + C`。
