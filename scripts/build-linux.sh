#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
  echo 'Run sh scripts/setup-linux.sh before building the desktop app.'
  exit 1
fi
.venv/bin/python -m pip install -r requirements-build.txt
cd frontend
npm run sidecar:build
npm run desktop:build -- --config src-tauri/tauri.linux.conf.json
cp ../packaging/linux/install-appimage.sh src-tauri/target/release/bundle/appimage/install-appimage.sh
cp src-tauri/icons/128x128.png src-tauri/target/release/bundle/appimage/ReePlay.png
echo 'Pacchetti Linux in frontend/src-tauri/target/release/bundle'
