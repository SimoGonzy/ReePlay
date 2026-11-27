# Third-party binaries bundled with desktop packages

The Windows x64 build includes the following programs in `bundled-tools` beside the ReePlay executable:

| Component | Version | Source | Included license |
| --- | --- | --- | --- |
| Node.js | 24.16.0 | [Official Windows x64 archive](https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-x64.zip) | `bundled-tools/licenses/node-LICENSE.txt` |
| FFmpeg and FFprobe | n9.0.2-57-gd838f9f9ae, shared LGPL build | [BtbN/FFmpeg-Builds](https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/tag/autobuild-2026-11-18-12-39) | `bundled-tools/licenses/ffmpeg-LICENSE.txt` |

`frontend/scripts/prepare-windows-tools.ps1` verifies SHA-256 hashes before extracting files. It includes only `node.exe`, `ffmpeg.exe`, `ffprobe.exe`, FFmpeg's required DLLs, and license texts. FFmpeg source and build instructions are available from the [FFmpeg project](https://ffmpeg.org/download.html#get-sources) and the [build repository](https://github.com/BtbN/FFmpeg-Builds). The `yt-dlp[default]` dependency, bundled in the Python engine, includes `yt-dlp-ejs` for YouTube JavaScript checks.

The Linux x64 build includes Node.js 24.16.0 from the [official archive](https://nodejs.org/dist/v24.16.0/node-v24.16.0-linux-x64.tar.xz) and FFmpeg/FFprobe n9.0.2-57-gd838f9f9ae from the [static LGPL archive](https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/tag/autobuild-2026-11-18-12-39). `frontend/scripts/prepare-linux-tools.sh` checks SHA-256 hashes, then copies only the three executables and licenses into `bundled-tools`. These tools are included in both the `.deb` and AppImage; the Python backend includes yt-dlp and `yt-dlp-ejs`.

When updating these components, update their URLs, hashes, versions, and this page together, then rebuild the sidecar and installer. Downloaded binaries remain outside Git.

The PyInstaller sidecar also bundles the Python libraries [`cryptography`](https://cryptography.io/en/latest/) (Apache-2.0 or BSD-3-Clause), [`zeroconf`](https://github.com/python-zeroconf/python-zeroconf) (LGPL-2.1-or-later), and [`ifaddr`](https://github.com/pydron/ifaddr) (MIT) for local network sharing. Their versions are selected by `requirements.txt` during the build. `build-sidecar.mjs` copies their license texts into `python-licenses/`, and the installers include them as resources. Before publishing a release, also check obligations for transitive dependencies.
