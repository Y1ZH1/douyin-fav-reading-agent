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
echo  Douyin favorite GUI
echo  The URL is printed below. Default:
echo    http://127.0.0.1:8899/
echo  If that port is reserved by Windows (Hyper-V/WSL),
echo  the app picks a nearby free port automatically.
echo  Press Ctrl+C in this window to stop.
echo ============================================
"%PY%" app.py
pause
