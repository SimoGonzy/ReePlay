@echo off
setlocal
cd /d "%~dp0.."
where python >nul 2>nul
if errorlevel 1 (echo Python 3.10 o superiore non trovato. & exit /b 1)
python -m venv .venv || exit /b 1
.venv\Scripts\python.exe -m pip install --upgrade pip || exit /b 1
.venv\Scripts\python.exe -m pip install -r requirements.txt || exit /b 1
where npm >nul 2>nul
if errorlevel 1 (echo Node.js e npm non trovati. & exit /b 1)
cd frontend
call npm ci || exit /b 1
call npm run build || exit /b 1
cd ..
if not exist content mkdir content
echo Dipendenze installate. Per creare l'installer desktop esegui scripts\build-windows.bat.
