@echo off
setlocal
cd /d "%~dp0.."
if not exist .venv\Scripts\python.exe (
  echo Run scripts\setup-windows.bat before building the desktop app.
  exit /b 1
)
.venv\Scripts\python.exe -m pip install -r requirements-build.txt || exit /b 1
cd frontend
call npm run sidecar:build || exit /b 1
call npm run desktop:build || exit /b 1
echo Installer Windows in frontend\src-tauri\target\release\bundle\nsis
