#!/bin/sh
set -eu

package=${1:-/artifacts/ReePlay_0.4.2_amd64.deb}
install_root=$(mktemp -d)
trap 'kill "$backend_pid" 2>/dev/null || true; rm -rf "$install_root"' EXIT HUP INT TERM
dpkg-deb -x "$package" "$install_root"
tools=$(find "$install_root/usr/lib" -maxdepth 2 -type d -name bundled-tools | head -n 1)
[ -n "$tools" ] || { echo 'Strumenti inclusi non trovati nel pacchetto.' >&2; exit 1; }
export MUSICAPP_DATA_DIR="$install_root/data"
export MUSICAPP_TOOLS_DIR="$tools"

"$install_root/usr/bin/musicapp-backend" > "$install_root/backend.log" 2>&1 &
backend_pid=$!
port=''
attempt=0
while [ "$attempt" -lt 80 ]; do
  port=$(sed -n 's/^MUSICAPP_PORT=\([0-9]*\)$/\1/p' "$install_root/backend.log" | head -n 1)
  [ -n "$port" ] && break
  kill -0 "$backend_pid"
  sleep 0.25
  attempt=$((attempt + 1))
done
[ -n "$port" ] || { cat "$install_root/backend.log"; exit 1; }

"$tools/node" - "$port" <<'JS'
const base = `http://127.0.0.1:${process.argv[2]}`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function json(path, options) {
  const response = await fetch(base + path, options)
  const data = await response.json()
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(data)}`)
  return data
}

const status = await json('/api/status')
if (!status.ffmpeg) throw new Error('FFmpeg non trovato dal motore installato')
if (!status.content.endsWith('/content/library')) throw new Error(`Percorso libreria errato: ${status.content}`)
console.log('Backend e FFmpeg: OK')

const sample = await json('/api/playlists', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Verifica installer' }),
})
const archive = await json(`/api/playlists/${encodeURIComponent(sample.id)}/export`, { method: 'POST' })
const fs = await import('node:fs')
if (!archive.path.endsWith('/content/share/Verifica installer.zip') || !fs.existsSync(archive.path)) {
  throw new Error(`Esportazione ZIP fallita: ${JSON.stringify(archive)}`)
}
await json(`/api/playlists/${encodeURIComponent(sample.id)}?keep_tracks=true`, { method: 'DELETE' })
if ((await json('/api/library')).playlists.some(item => item.id === sample.id)) throw new Error('Playlist non eliminata')
console.log('ZIP, eliminazione e cartelle dati: OK')

const sharing = await json('/api/network/start', { method: 'POST' })
if (!sharing.enabled || !sharing.port || !sharing.fingerprint) throw new Error(`Rete Locale: ${JSON.stringify(sharing)}`)
const pairing = await json('/api/network/code', { method: 'POST' })
if (!/^\d{6}$/.test(pairing.code || '')) throw new Error('Codice di associazione non disponibile')
const stopped = await json('/api/network/stop', { method: 'POST' })
if (stopped.enabled) throw new Error('Server di rete ancora attivo')
console.log('Rete Locale inclusa: OK')
if (process.env.MUSICAPP_SMOKE_NETWORK_ONLY === '1') process.exit(0)

const preview = await json('/api/preview', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=DTi8wZ1a1TA' }),
})
let job
for (let i = 0; i < 120; i++) {
  job = await json(`/api/jobs/${preview.id}`)
  if (job.state === 'ready' || job.state === 'error') break
  await sleep(500)
}
if (job.state !== 'ready' || job.found < 1) throw new Error(`Anteprima: ${JSON.stringify(job)}`)
console.log('Ricerca con yt-dlp e Node: OK')

await json(`/api/jobs/${preview.id}/download`, { method: 'POST' })
for (let i = 0; i < 240; i++) {
  job = await json(`/api/jobs/${preview.id}`)
  if (job.state === 'done' || job.state === 'error') break
  await sleep(500)
}
if (job.state !== 'done' || job.downloaded < 1) throw new Error(`Download: ${JSON.stringify(job)}`)
const library = await json('/api/library')
if (!library.singles.some(track => String(track.file || track.filename || '').endsWith('.mp3'))) {
  throw new Error(`MP3 non visibile in libreria: ${JSON.stringify(library)}`)
}
console.log('Download MP3 e libreria: OK')
JS
