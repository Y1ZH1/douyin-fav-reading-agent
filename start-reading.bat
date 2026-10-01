@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   收藏阅读 Agent —— 本地双进程启动
echo ============================================
echo   1) 转写服务  Flask  :8899   收藏 / 转写 / 检索 / 向量
echo   2) 阅读 Agent Node :3001  +  Vite :5173
echo.
echo   笔记库：%DOUYIN_OBSIDIAN_DIR%
if "%DOUYIN_OBSIDIAN_DIR%"=="" echo   笔记库：用 douyin-fav-transcribe/core.py 里的 DEFAULT_OBSIDIAN
echo.

if not exist "douyin-fav-transcribe\app.py" (
  echo [错误] 找不到 douyin-fav-transcribe\app.py
  echo        请在仓库根目录运行本脚本。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [提示] 还没装依赖，先在根目录跑一次：npm install
  echo        首次运行还需要 cd client ^&^& npm install 和 cd server ^&^& npm install
  echo.
)

start "转写服务 8899" cmd /k "cd /d "%~dp0douyin-fav-transcribe" && start-gui.bat"
start "阅读 Agent 5173+3001" cmd /k "cd /d "%~dp0" && npm run dev"

echo 正在等两个服务起来（各最多 90 秒）...
echo.

set /a tries=0
:wait_flask
set /a tries+=1
curl -s -o nul --max-time 2 http://127.0.0.1:8899/api/obsidian-dir
if not errorlevel 1 goto flask_ok
if !tries! geq 45 goto flask_timeout
timeout /t 2 /nobreak >nul
goto wait_flask

:flask_ok
echo [OK] 转写服务已就绪（:8899）
goto wait_web

:flask_timeout
echo [!]  90 秒内没连上转写服务 :8899
echo     阅读页仍然能打开，但「收藏夹列表 / 检索 / 分类」会用不了。
echo     常见原因：cap-backend 的 .venv 没建好、依赖没装、或 8899 被占用。
echo.

:wait_web
set /a tries=0
:loop_web
set /a tries+=1
curl -s -o nul --max-time 2 http://127.0.0.1:5173
if not errorlevel 1 goto web_ok
if !tries! geq 45 goto web_timeout
timeout /t 2 /nobreak >nul
goto loop_web

:web_ok
echo [OK] 阅读页已就绪，正在打开浏览器…
start "" http://127.0.0.1:5173
goto done

:web_timeout
echo [!]  90 秒内没连上 :5173
echo     看「阅读 Agent」那个窗口里的报错，多半是还没 npm install。
echo.

:done
echo ============================================
echo  两个窗口都不要关。
echo  Obsidian 里也可以用 Web Viewer / Custom Frames 打开 http://127.0.0.1:5173
echo  要停服务：直接关掉那两个命令行窗口。
echo ============================================
pause
