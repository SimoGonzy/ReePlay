# Contributing to ReePlay

ReePlay is a desktop app for Windows and Linux. The interface uses React/TypeScript, the window uses Tauri, and the local engine uses Python/FastAPI. The desktop release does not require a separate web server.

## Where to change the code

| Area | Start here |
| --- | --- |
| Screens, playlists, themes, and library search | `frontend/src/App.tsx`, `frontend/src/style.css`, `frontend/src/retro.css`, `frontend/src/visual-themes.css`, `frontend/src/types.ts` |
| Player and audio controls | `frontend/src/Player.tsx` |
| Starting the engine from the window | `frontend/src/backend.ts`, `backend_entry.py`, `frontend/src-tauri/src/main.rs` |
| Downloads, YouTube search, and MP3 metadata | `musicapp/pipeline.py`, `musicapp/sources.py` |
| Local API and library files | `musicapp/server.py`, `musicapp/storage.py` |
| LAN sharing, pairing, and remote catalog | `musicapp/network.py`, `frontend/src/Network.tsx`, `frontend/src/tracks.ts` |
| Theme images and example manifests | `frontend/public/images/`, `themes/examples/`, `docs/themes.md`, `docs/brand/` |
| Windows/Linux installers | `scripts/`, `frontend/scripts/`, `packaging/linux/`, `frontend/src-tauri/` |

The [local network guide](docs/rete-locale.md) describes the protocol and usage. The LAN API is separate from the local API and is read-only; preserve that separation when adding features.

## Setup and verification

From the project root on Windows:

```powershell
.\scripts\setup-windows.bat
cd frontend
npm run build
```

From the project root on Linux:

```sh
sh scripts/setup-linux.sh
cd frontend
npm run build
```

The `scripts/build-windows.bat` and `scripts/build-linux.sh` scripts create desktop packages after the Tauri prerequisites are installed. On Windows with Docker Desktop, `powershell -ExecutionPolicy Bypass -File scripts/build-linux-docker.ps1` builds Linux packages. Download tools bundled with the packages are documented in [third-party binaries](docs/third-party-binaries.md).

The local development copy may contain `tests/`. That folder is ignored by Git and is not part of the public repository. If present, run `python -m unittest discover -s tests -v`.

To launch Tauri in development, run `npm run sidecar:build` and then `npm run desktop:dev` in `frontend/`. On Linux, add `-- --config src-tauri/tauri.linux.conf.json` to the second command. The `.venv` and `frontend/node_modules` directories are local and ignored by Git.

Do not commit MP3 files, personal playlists, exported ZIPs in `content/share/`, credentials or certificates in `config/network/`, downloaded archives, or generated binaries. Only `.gitkeep` files retain `content/library/` and `content/share/` in the source tree. The MIT license covers ReePlay's code; bundled third-party components retain their own licenses. Internal names such as `musicapp`, `MUSICAPP_DATA_DIR`, and `dev.musicapp.desktop` remain for compatibility with earlier data and installations.
