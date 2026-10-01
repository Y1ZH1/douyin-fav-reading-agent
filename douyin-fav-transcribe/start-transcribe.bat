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

echo Transcribing favorites with local Whisper (model: large-v3)...
"%PY%" transcribe_favs.py %*
echo.
echo Done. Notes were written into your Obsidian vault
echo (folder configured via DOUYIN_OBSIDIAN_DIR).
pause
