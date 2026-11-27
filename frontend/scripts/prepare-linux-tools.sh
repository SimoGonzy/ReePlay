#!/usr/bin/env sh
set -eu

if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
  echo 'Questa preparazione supporta Linux x86_64.' >&2
  exit 1
fi

frontend=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cache="$frontend/.vendor-cache"
tools="$frontend/src-tauri/bundled-tools"
node_archive='node-v24.16.0-linux-x64.tar.xz'
node_sha='d804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9'
ffmpeg_archive='ffmpeg-n9.0.2-57-gd838f9f9ae-linux64-lgpl-9.0.tar.xz'
ffmpeg_sha='ead99a4068892760a01a27fa437bdf1975e29a967bc011554d518ae906b1a342'
ffmpeg_url="https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-18-12-39/$ffmpeg_archive"

mkdir -p "$cache" "$tools/licenses"
download_verified() {
  archive=$1
  sha=$2
  url=$3
  if [ ! -f "$cache/$archive" ] || ! printf '%s  %s\n' "$sha" "$cache/$archive" | sha256sum -c - >/dev/null 2>&1; then
    curl -fL --retry 3 --retry-delay 2 "$url" -o "$cache/$archive.tmp"
    printf '%s  %s\n' "$sha" "$cache/$archive.tmp" | sha256sum -c -
    mv "$cache/$archive.tmp" "$cache/$archive"
  fi
}

download_verified "$node_archive" "$node_sha" "https://nodejs.org/dist/v24.16.0/$node_archive"
download_verified "$ffmpeg_archive" "$ffmpeg_sha" "$ffmpeg_url"

tar -xJOf "$cache/$node_archive" 'node-v24.16.0-linux-x64/bin/node' > "$tools/node"
tar -xJOf "$cache/$node_archive" 'node-v24.16.0-linux-x64/LICENSE' > "$tools/licenses/node-LICENSE"

extract=$(mktemp -d)
trap 'rm -rf "$extract"' EXIT HUP INT TERM
tar -xJf "$cache/$ffmpeg_archive" -C "$extract"
ffmpeg_bin=$(find "$extract" -type f -path '*/bin/ffmpeg' -print -quit)
ffprobe_bin=$(find "$extract" -type f -path '*/bin/ffprobe' -print -quit)
if [ -z "$ffmpeg_bin" ] || [ -z "$ffprobe_bin" ]; then
  echo 'Archivio FFmpeg privo di ffmpeg o ffprobe.' >&2
  exit 1
fi
install -m 755 "$ffmpeg_bin" "$tools/ffmpeg"
install -m 755 "$ffprobe_bin" "$tools/ffprobe"
ffmpeg_license=$(find "$extract" -type f -name LICENSE.txt -print -quit)
if [ -z "$ffmpeg_license" ]; then
  echo 'Archivio FFmpeg privo del testo della licenza.' >&2
  exit 1
fi
install -m 644 "$ffmpeg_license" "$tools/licenses/ffmpeg-LICENSE.txt"
chmod 755 "$tools/node"

"$tools/node" --version
"$tools/ffmpeg" -hide_banner -version | head -n 1
"$tools/ffprobe" -hide_banner -version | head -n 1
