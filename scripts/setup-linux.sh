#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
cd frontend
npm ci
npm run build
cd ..
mkdir -p content
printf '%s\n' 'Dipendenze installate. Per creare i pacchetti desktop esegui sh scripts/build-linux.sh.'
