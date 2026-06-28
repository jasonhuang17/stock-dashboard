@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Stock Dashboard 啟動器

echo ============================================
echo   Stock Dashboard 啟動中...
echo ============================================
echo.

:: ── 取得此 bat 檔所在目錄（確保路徑正確）────────────────────────
set ROOT=%~dp0
set ROOT=%ROOT:~0,-1%

:: ────────────────────────────────────────────────────────────────
:: 1. 檢查 Python
:: ────────────────────────────────────────────────────────────────
echo [1/4] 檢查 Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ❌ 找不到 Python！
    echo.
    echo  請依以下步驟安裝：
    echo  1. 開啟瀏覽器，前往 https://www.python.org/downloads/
    echo  2. 點擊 "Download Python 3.x.x"（選最新版）
    echo  3. 執行安裝檔，【重要】勾選 "Add Python to PATH"
    echo  4. 安裝完成後，重新開啟此視窗再執行一次
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo  ✅ %%v


:: ────────────────────────────────────────────────────────────────
:: 2. 檢查 Node.js
:: ────────────────────────────────────────────────────────────────
echo [2/4] 檢查 Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ❌ 找不到 Node.js！
    echo.
    echo  請依以下步驟安裝：
    echo  1. 開啟瀏覽器，前往 https://nodejs.org/
    echo  2. 點擊 "LTS" 版本下載（推薦，穩定版）
    echo  3. 執行安裝檔，全部選預設值即可
    echo  4. 安裝完成後，重新開啟此視窗再執行一次
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>^&1') do echo  ✅ Node.js %%v


:: ────────────────────────────────────────────────────────────────
:: 3. 安裝 Python 套件（如果還沒裝）
:: ────────────────────────────────────────────────────────────────
echo [3/4] 檢查 Python 套件...
python -c "import fastapi, uvicorn, yfinance" >nul 2>&1
if errorlevel 1 (
    echo  首次使用，正在安裝 Python 套件（約需 1-2 分鐘）...
    pip install -r "%ROOT%\js\backend\requirements.txt"
    if errorlevel 1 (
        echo.
        echo  ❌ Python 套件安裝失敗！
        echo.
        echo  請手動執行：
        echo    pip install -r js\backend\requirements.txt
        echo.
        pause
        exit /b 1
    )
    echo  ✅ Python 套件安裝完成
) else (
    echo  ✅ Python 套件已就緒
)


:: ────────────────────────────────────────────────────────────────
:: 4. 安裝 Node 套件（如果還沒裝）
:: ────────────────────────────────────────────────────────────────
echo [4/4] 檢查 Node 套件...
if not exist "%ROOT%\js\frontend\node_modules" (
    echo  首次使用，正在安裝 Node 套件（約需 1-3 分鐘）...
    cd "%ROOT%\js\frontend"
    npm install
    if errorlevel 1 (
        echo.
        echo  ❌ Node 套件安裝失敗！
        echo.
        echo  請手動執行：
        echo    cd js\frontend
        echo    npm install
        echo.
        pause
        exit /b 1
    )
    echo  ✅ Node 套件安裝完成
) else (
    echo  ✅ Node 套件已就緒
)


:: ────────────────────────────────────────────────────────────────
:: 啟動服務
:: ────────────────────────────────────────────────────────────────
echo.
echo ============================================
echo   正在啟動服務...
echo ============================================
echo.

:: 啟動 Backend（獨立視窗）
start "Stock Dashboard - Backend :8000" cmd /k "cd /d "%ROOT%\js\backend" && echo Backend 啟動中... && uvicorn main:app --port 8000"

:: 稍等 2 秒讓 backend 先起來
timeout /t 2 /nobreak >nul

:: 啟動 Frontend（獨立視窗）
start "Stock Dashboard - Frontend :3000" cmd /k "cd /d "%ROOT%\js\frontend" && echo Frontend 啟動中... && npm run dev"

:: 等 5 秒讓 frontend 編譯
echo  Backend 與 Frontend 啟動中，請稍候...
timeout /t 5 /nobreak >nul

:: 開啟瀏覽器
echo  開啟瀏覽器...
start "" "http://localhost:3000"

echo.
echo ============================================
echo   ✅ Stock Dashboard 已啟動
echo.
echo   網址：http://localhost:3000
echo   API： http://localhost:8000/docs
echo.
echo   關閉方式：關閉 Backend 和 Frontend 兩個視窗
echo ============================================
echo.
pause
