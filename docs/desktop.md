# Desktop architecture

ReePlay uses a Tauri window containing the compiled React/TypeScript frontend. Images for **Vaporwave**, **Memphis Shapes**, **Stereo 2000**, and **Coastal Sunset** are stored in `frontend/public/images/`; Vite includes them in `frontend/dist/images/`.

On Windows, `frontend/src-tauri/tauri.windows.conf.json` disables the native title bar. `frontend/src/WindowFrame.tsx` displays ReePlay's title bar, uses theme variables, and handles dragging, double-click to maximize or restore, minimizing, and closing. The bar remains available if the Python engine fails to start. Linux retains the desktop's native title bar.

The Python process in `backend_entry.py` is compiled with PyInstaller and packaged as a sidecar. At launch, it selects a free port on `127.0.0.1` and prints `MUSICAPP_PORT=<port>`; `frontend/src/backend.ts` waits for the API before mounting the interface. The API accepts requests only from local Tauri and development server origins. Closing the window requests the sidecar to shut down. On demand, the Local Network section starts a separate read-only HTTPS service managed by `musicapp/network.py`.

The desktop package stores MP3 and `.info` files in `~/Documents/MusicApp/content/library`, exported ZIPs in `~/Documents/MusicApp/content/share`, themes in `~/Documents/MusicApp/themes/plugins`, and the certificate and pairings in `~/Documents/MusicApp/config/network`. At launch, `prepare_content_layout()` migrates old playlists and MP3 files from `content/` into `content/library/` without overwriting files. `MUSICAPP_DATA_DIR` selects another data root. The technical name `musicapp` and Tauri identifier `dev.musicapp.desktop` are retained for compatibility; the visible name and main executable are `ReePlay` and `reeplay`. Personal data is not part of the repository.

## Building

- Windows: Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), run `.\scripts\setup-windows.bat`, then `.\scripts\build-windows.bat`.
- Linux: Install the Tauri prerequisites for your distribution, run `sh scripts/setup-linux.sh`, then `sh scripts/build-linux.sh`.
- Docker Desktop on Windows: `powershell -ExecutionPolicy Bypass -File scripts/build-linux-docker.ps1` produces x64 `.deb` and AppImage packages in `dist-linux/`.

`frontend/scripts/build-sidecar.mjs` creates the binary with the suffix required by Tauri and copies Python LAN library licenses into `frontend/src-tauri/python-licenses/`. The `prepare-windows-tools` and `prepare-linux-tools` scripts download Node.js, FFmpeg, and FFprobe, verify SHA-256 hashes, and prepare `frontend/src-tauri/bundled-tools/`. Both Tauri configurations include these folders as resources. The Python engine adds `bundled-tools` to its `PATH` so yt-dlp finds the tools without a separate installation.

Windows and Linux x64 packages include the download tools. Versions and licenses are documented in [third-party binaries](third-party-binaries.md). The `.venv/`, `frontend/node_modules/`, `frontend/.vendor-cache/`, `frontend/src-tauri/binaries/`, `frontend/src-tauri/bundled-tools/`, and `frontend/src-tauri/target/` folders are generated locally and excluded from Git.
