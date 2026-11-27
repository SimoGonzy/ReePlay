@echo off
setlocal
cd /d "%~dp0.."
where python >nul 2>nul
if errorlevel 1 (echo Python 3.10 or later not found. & exit /b 1)
python -m venv .venv || exit /b 1
.venv\Scripts\python.exe -m pip install --upgrade pip || exit /b 1
.venv\Scripts\python.exe -m pip install -r requirements.txt || exit /b 1
where npm >nul 2>nul
if errorlevel 1 (echo Node.js and npm not found. & exit /b 1)
cd frontend
call npm ci || exit /b 1
call npm run build || exit /b 1
cd ..
if not exist content mkdir content
echo Dependencies installed. Run scripts\build-windows.bat to build the desktop installer.
