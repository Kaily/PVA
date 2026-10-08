@echo off
setlocal
title PVA-61 Professional Arranger
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist node_modules goto build
echo Installing dependencies. This happens once and takes about a minute...
call npm install
if errorlevel 1 goto failed

:build
echo Building PVA-61...
call npx vite build
if errorlevel 1 goto failed

echo.
echo PVA-61 is starting in your browser.
echo Keep this window open while you play. Close it to stop.
echo.
call npx vite preview --open
goto end

:nonode
echo Node.js was not found on this computer.
echo Install Node.js 22 LTS from https://nodejs.org and run start.bat again.
pause
goto end

:failed
echo.
echo Something went wrong. The messages above say what.
pause

:end
endlocal
