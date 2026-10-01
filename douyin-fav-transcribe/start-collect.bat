@echo off
setlocal
cd /d "%~dp0"

REM Optional local config (config.env is git-ignored; put personal paths there)
if exist "config.env" call "config.env"

REM Pick a Python: cap-backend venv -> local .venv -> system python
if exist "..\cap-backend\.venv\Scripts\python.exe" (
  set "PY=..\cap-backend\.venv\Scripts\python.exe"
) else if exist ".venv\Scripts\python.exe" (
  set "PY=.venv\Scripts\python.exe"
) else (
  set "PY=python"
)

echo ============================================
echo   Douyin favorite collector
echo   In the Chrome window that pops up:
echo     1) scan QR to login (first time only)
echo     2) open Favorites tab and scroll down
echo   Close the Chrome window when done.
echo   Data is saved live to state\collected.json
echo ============================================
"%PY%" collector.py
pause
