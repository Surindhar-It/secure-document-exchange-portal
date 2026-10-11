@echo off
title FortressShare Secure Exchange Portal
cls

echo ==============================================================
echo           FORTRESSSHARE EXCHANGE PORTAL - LAUNCHER
echo ==============================================================
echo.
echo  This launcher script will boot up your secure workspace nodes.
echo.
echo  Select your startup configuration:
echo   [1] Launch Portal ONLY (Using JavaScript Local Security Rules)
echo   [2] Launch Portal + AI Security Engine (Using Python FastAPI ML Model)
echo   [3] Build Production Bundle and Sync SQLite Node
echo   [4] Exit
echo.
set /p opt="Enter selection [1-4]: "

if "%opt%"=="1" goto portal_only
if "%opt%"=="2" goto portal_and_ai
if "%opt%"=="3" goto build_and_sync
if "%opt%"=="4" goto end
goto invalid

:portal_only
echo.
echo [Node] Booting Next.js Developer Server...
npm run dev
goto end

:portal_and_ai
echo.
echo [System] Booting node services concurrently...
echo [System] Starting AI Security Engine on http://127.0.0.1:8000
start cmd /k "cd security-engine && python -m pip install -r requirements.txt && python main.py"
echo [Node] Booting Next.js Developer Server on http://localhost:3000
npm run dev
goto end

:build_and_sync
echo.
echo [Prisma] Synchronizing SQLite local database file...
call npx prisma db push
echo.
echo [Next.js] Compiling production build bundle...
call npm run build
echo.
echo [System] Synchronization complete. Press any key to return.
pause
goto start

:invalid
echo Invalid option selected.
pause
goto start

:end
echo.
echo [System] Exiting Secure File Exchange portal shell.
pause
