import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronDown, ChevronUp, CircleAlert, Copy, Download, FolderPlus, Home, Link2, ListMusic, MoreVertical, Music2, Palette, Pencil, Play, Plus, Search, Share2, Trash2, Wifi } from 'lucide-react'
import Player from './Player'
import Network from './Network'
import { api, apiUrl, errorMessage } from './backend'
import { trackKey } from './tracks'
import type { ImportJob, Library, Playlist, Status, Theme, ThemeColor, Track } from './types'

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const time = (seconds?: number): string => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`
const key = trackKey
const themes: Theme[] = [{ id: 'dark', name: 'Scuro', style: 'flat' }, { id: 'retro', name: 'Graphite 90', style: 'flat' }, { id: 'vaporwave', name: 'Vaporwave', style: 'flat' }, { id: 'memphis', name: 'Memphis Shapes', style: 'flat' }, { id: 'aero', name: 'Stereo 2000', style: 'glossy' }, { id: 'sunset', name: 'Tramonto costiero', style: 'flat' }]
const themeAccents: Record<string, string> = { dark: '#2785f6', retro: '#5bd7c1', vaporwave: '#ec78bf', memphis: '#ffd063', aero: '#60d8f0', sunset: '#f08299' }
const colors: ThemeColor[] = ['bg', 'sidebar', 'surface', 'text', 'muted', 'border', 'accent', 'accent_text', 'selected', 'row_alt', 'player', 'danger', 'positive']

function Cover({ track, playlist, large = false }: { track?: Track; playlist?: Playlist; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  const url = playlist?.cover_version ? apiUrl(`/api/playlists/${encodeURIComponent(playlist.id)}/cover?v=${playlist.cover_version}`) : track ? apiUrl(`/api/art/${encodeURIComponent(track.playlist || '_singles')}/${encodeURIComponent(track.file)}`) : null
  useEffect(() => setFailed(false), [url])
  return <div className={`cover ${large ? 'cover-large' : ''}`}>{url && !failed ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} /> : <Music2 size={large ? 40 : 19} />}</div>
}

function JobsDock({ jobs, onDownload, dismissed, onDismiss }: { jobs: ImportJob[]; onDownload: (id: string) => Promise<void>; dismissed: string[]; onDismiss: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const visible = jobs.filter(job => !dismissed.includes(job.id))
  if (!visible.length) return null
  return <aside className="jobs-dock"><button className="jobs-heading" onClick={() => setCollapsed(!collapsed)}><Download size={17} /><strong>Importazioni</strong><span>{visible.filter(job => ['searching', 'downloading'].includes(job.state)).length || visible.length}</span>{collapsed ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>{!collapsed && <div className="jobs-list">{visible.map(job => { const pct = job.progress?.total_bytes ? Math.min(100, 100 * (job.progress.bytes || 0) / job.progress.total_bytes) : null; return <section className="job" key={job.id}><div className="job-title"><strong>{job.title || 'Ricerca brani'}</strong>{!['searching', 'downloading'].includes(job.state) && <button onClick={() => onDismiss(job.id)} aria-label="Nascondi">×</button>}</div><p>{job.state === 'searching' ? `${job.searched} di ${job.total || '…'} controllati` : job.state === 'downloading' ? `${job.downloaded} di ${job.found} scaricati · ${job.current || 'Preparazione…'}` : job.state === 'ready' ? `${job.found} trovati su ${job.total}` : job.state === 'done' ? `${job.downloaded} scaricati · ${job.failed.length} non riusciti` : job.error}</p>{['searching', 'downloading'].includes(job.state) && <div className="progress-track"><div style={{ width: `${job.state === 'searching' ? (job.total ? 100 * job.searched / job.total : 4) : (pct ?? 4)}%` }} /></div>}{job.state === 'downloading' && <small>{pct == null ? 'Dimensione in attesa…' : `${Math.round(pct)}% · ${Math.round((job.progress.bytes || 0) / 1048576)} MB`}{job.progress?.eta_seconds != null ? ` · circa ${time(job.progress.eta_seconds)} rimasti` : ''}</small>}{job.state === 'ready' && <><button className="primary job-action" disabled={!job.found} onClick={() => onDownload(job.id)}>Scarica {job.found} brani</button>{job.estimated_bytes && <small>Circa {Math.round(job.estimated_bytes / 1048576)} MB</small>}</>}{job.missing?.length > 0 && <details><summary>{job.missing.length} non trovati</summary><ul>{job.missing.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}{job.failed?.length > 0 && <details><summary>{job.failed.length} download falliti</summary><ul>{job.failed.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}</section> })}</div>}</aside>
}

function TransferDialog({ track, playlists, onClose, onSubmit }: { track: Track; playlists: Playlist[]; onClose: () => void; onSubmit: (track: Track, destination: string, newTitle: string, move: boolean) => Promise<void> }) {
  const [destination, setDestination] = useState(playlists.find(item => item.id !== track.playlist)?.id || '__new')
  const [newTitle, setNewTitle] = useState('')
  const [move, setMove] = useState(true)
  const [busy, setBusy] = useState(false)
  return <div className="overlay"><form className="dialog" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSubmit(track, destination, newTitle, move) } finally { setBusy(false) } }}><button type="button" className="dialog-close" onClick={onClose} aria-label="Chiudi">×</button><FolderPlus size={25} className="dialog-icon" /><h2>Organizza il brano</h2><p className="muted">{track.artist ? `${track.artist} · ` : ''}{track.title}</p><label className="field">Destinazione<select value={destination} onChange={e => setDestination(e.target.value)}>{playlists.filter(item => item.id !== track.playlist).map(item => <option key={item.id} value={item.id}>{item.titolo}</option>)}{track.playlist && <option value="_singles">Libreria (fuori dalle playlist)</option>}<option value="__new">+ Nuova playlist</option></select></label>{destination === '__new' && <label className="field">Nome della nuova playlist<input value={newTitle} onChange={e => setNewTitle(e.target.value)} required maxLength={120} placeholder="La mia playlist" /></label>}<div className="choice"><label><input type="radio" checked={move} onChange={() => setMove(true)} /> Sposta</label><label><input type="radio" checked={!move} onChange={() => setMove(false)} /> Copia</label></div><button className="primary full" disabled={busy || (destination === '__new' && !newTitle.trim())} type="submit">{busy ? 'Salvataggio…' : move ? 'Sposta brano' : 'Copia brano'}</button></form></div>
}

function PlaylistEditor({ playlist, onClose, onSave }: { playlist: Playlist; onClose: () => void; onSave: (playlist: Playlist, title: string, file: File | null) => Promise<void> }) {
  const [title, setTitle] = useState(playlist.titolo)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  return <div className="overlay"><form className="dialog" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSave(playlist, title, file) } finally { setBusy(false) } }}><button type="button" className="dialog-close" onClick={onClose} aria-label="Chiudi">×</button><Pencil size={24} className="dialog-icon" /><h2>Modifica playlist</h2><label className="field">Nome<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={120} /></label><label className="field">Copertina PNG, JPEG o WebP (massimo 4 MB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} /></label><p className="muted">La cartella dei brani conserva il suo nome attuale.</p><button className="primary full" disabled={busy || !title.trim()} type="submit">{busy ? 'Salvataggio…' : 'Salva modifiche'}</button></form></div>
}

function DeletePlaylistDialog({ playlist, onClose, onDelete }: { playlist: Playlist; onClose: () => void; onDelete: (playlist: Playlist, keepTracks: boolean) => Promise<void> }) {
  const [keepTracks, setKeepTracks] = useState(true)
  const [busy, setBusy] = useState(false)
  return <div className="overlay"><form className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-playlist-title" onSubmit={async event => { event.preventDefault(); setBusy(true); try { await onDelete(playlist, keepTracks) } finally { setBusy(false) } }}><button type="button" className="dialog-close" onClick={onClose} aria-label="Chiudi">×</button><Trash2 size={24} className="dialog-icon" /><h2 id="delete-playlist-title">Elimina playlist</h2><p className="muted">Scegli cosa fare con i {playlist.tracks.length} brani di “{playlist.titolo}”.</p><div className="delete-options"><label><input type="radio" name="delete-mode" checked={keepTracks} onChange={() => setKeepTracks(true)} /> Elimina la playlist e conserva i brani nella Libreria</label><label><input type="radio" name="delete-mode" checked={!keepTracks} onChange={() => setKeepTracks(false)} /> Elimina la playlist e i file dei suoi brani</label></div><button className="primary full danger-action" disabled={busy} type="submit">{busy ? 'Eliminazione…' : 'Conferma eliminazione'}</button></form></div>
}

function ThemePicker({ available, selected, onSelect }: { available: Theme[]; selected: string; onSelect: (id: string) => void }) {
  const picker = useRef<HTMLDetailsElement>(null)
  const current = available.find(item => item.id === selected)
  return <details className="theme-picker" ref={picker}><summary aria-label="Scegli tema"><Palette size={18} /><span>{current?.name || 'Tema'}</span><ChevronDown size={15} /></summary><div className="theme-menu" aria-label="Temi disponibili">{available.map(item => <button type="button" key={item.id} aria-pressed={item.id === selected} onClick={() => { onSelect(item.id); if (picker.current) picker.current.open = false }}><span className="theme-swatch" style={{ background: item.colors?.accent || themeAccents[item.id] || '#2785f6' }} /><span>{item.name}</span>{item.id === selected && <Check size={15} />}</button>)}</div></details>
}

export default function App() {
  const [library, setLibrary] = useState<Library>({ playlists: [], singles: [] })
  const [selected, setSelected] = useState('library')
  const [url, setUrl] = useState('')
  const [query, setQuery] = useState('')
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])
  const [error, setError] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [remoteTracks, setRemoteTracks] = useState<Track[]>([])
  const [transfer, setTransfer] = useState<Track | null>(null)
  const [editing, setEditing] = useState<Playlist | null>(null)
  const [deleting, setDeleting] = useState<Playlist | null>(null)
  const [shareNotice, setShareNotice] = useState<{ name: string; path: string; size: number } | null>(null)
  const [sharing, setSharing] = useState(false)
  const [themeId, setThemeId] = useState(() => { const saved = localStorage.getItem('reeplay-theme'); if (saved) return saved; const previous = localStorage.getItem('musicapp-theme'); return previous && previous !== 'retro' && previous !== 'light' ? previous : 'dark' })
  const [plugins, setPlugins] = useState<Theme[] | null>(null)
  useEffect(() => setShareNotice(null), [selected])
  const lastDownloaded = useRef(0)
  const refresh = () => api<Library>('/api/library').then(setLibrary).catch(e => setError(errorMessage(e)))
  useEffect(() => {
    refresh(); api<Status>('/api/status').then(setStatus).catch(() => {}); api<{ plugins: Theme[] }>('/api/themes').then(data => setPlugins(data.plugins)).catch(() => setPlugins([]))
    const timer = setInterval(() => api<{ jobs: ImportJob[] }>('/api/jobs').then(data => { setJobs(data.jobs); const count = data.jobs.reduce((total, job) => total + job.downloaded, 0); if (count !== lastDownloaded.current) { lastDownloaded.current = count; refresh() } }).catch(() => {}), 1500)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (themeId.startsWith('plugin:') && plugins === null) return
    const theme = [...themes, ...(plugins || [])].find(item => item.id === themeId) || themes[0]
    const root = document.documentElement
    root.dataset.theme = theme.id.startsWith('plugin:') ? 'plugin' : theme.id
    root.dataset.style = theme.style
    for (const color of colors) {
      const variable = `--${color.replace('_', '-')}`
      if (theme.colors?.[color]) root.style.setProperty(variable, theme.colors[color])
      else root.style.removeProperty(variable)
    }
    localStorage.setItem('reeplay-theme', theme.id)
  }, [themeId, plugins])
  const playlist = library.playlists.find(item => item.id === selected)
  const allTracks = useMemo(() => [...library.singles, ...library.playlists.flatMap(item => item.tracks)], [library])
  const display = playlist ? playlist.tracks : allTracks
  const filtered = display.filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(query.toLowerCase()))
  const importLink = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(''); try { const job = await api<ImportJob>('/api/preview', post({ url })); setJobs(items => [job, ...items]); setUrl('') } catch (failure) { setError(errorMessage(failure)) } }
  const createPlaylist = async () => { const title = window.prompt('Nome della nuova playlist:'); if (!title?.trim()) return; try { const created = await api<{ id: string }>('/api/playlists', post({ title })); await refresh(); setSelected(created.id) } catch (failure) { setError(errorMessage(failure)) } }
  const submitTransfer = async (track: Track, destination: string, newTitle: string, move: boolean) => { try { let target = destination; if (target === '__new') target = (await api<{ id: string }>('/api/playlists', post({ title: newTitle }))).id; await api('/api/tracks/transfer', post({ source: track.playlist || '_singles', file: track.file, destination: target, move })); setTransfer(null); await refresh(); if (destination === '__new') setSelected(target) } catch (failure) { setError(errorMessage(failure)) } }
  const savePlaylist = async (item: Playlist, title: string, file: File | null) => { try { if (title.trim() !== item.titolo) await api(`/api/playlists/${encodeURIComponent(item.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }); if (file) { if (file.size > 4 * 1024 * 1024) throw new Error('Scegli un’immagine di massimo 4 MB.'); await api(`/api/playlists/${encodeURIComponent(item.id)}/cover`, { method: 'PUT', body: file }) } setEditing(null); await refresh() } catch (failure) { setError(errorMessage(failure)) } }
  const deletePlaylist = async (item: Playlist, keepTracks: boolean) => { try { await api(`/api/playlists/${encodeURIComponent(item.id)}?keep_tracks=${keepTracks}`, { method: 'DELETE' }); if (active?.startsWith(`${item.id}/`)) setActive(null); setDeleting(null); setShareNotice(null); setSelected('library'); await refresh() } catch (failure) { setError(errorMessage(failure)) } }
  const sharePlaylist = async (item: Playlist) => { setSharing(true); setShareNotice(null); try { setShareNotice(await api<{ name: string; path: string; size: number }>(`/api/playlists/${encodeURIComponent(item.id)}/export`, { method: 'POST' })) } catch (failure) { setError(errorMessage(failure)) } finally { setSharing(false) } }
  return <div className="app">
    <aside className="sidebar"><div className="brand"><img className="brand-wordmark" src="/images/reeplay-wordmark.svg" alt="ReePlay" /><small>LOCAL AUDIO SYSTEM</small></div><nav><button className={selected === 'library' ? 'selected' : ''} onClick={() => setSelected('library')}><Home size={18} /> Libreria</button><button className={selected === 'network' ? 'selected' : ''} onClick={() => setSelected('network')}><Wifi size={18} /> Rete Locale</button></nav><div className="sidebar-heading"><span>Le mie playlist</span><button onClick={createPlaylist} aria-label="Crea playlist"><Plus size={18} /></button></div><div className="playlist-nav">{library.playlists.map(item => <button key={item.id} className={selected === item.id ? 'selected' : ''} onClick={() => setSelected(item.id)} title={item.titolo}>{item.cover_version ? <img className="playlist-icon" src={apiUrl(`/api/playlists/${encodeURIComponent(item.id)}/cover?v=${item.cover_version}`)} alt="" /> : <ListMusic size={18} />}<span>{item.titolo}</span></button>)}</div><div className="sidebar-foot"><ThemePicker available={[...themes, ...(plugins || [])]} selected={themeId} onSelect={setThemeId} />{status && <div className="status-line"><span className={`status-dot ${status.ffmpeg ? '' : 'missing'}`} />{status.ffmpeg ? 'Pronto per i download' : 'FFmpeg mancante'}</div>}</div></aside>
    <div className="main"><form className="toolbar" onSubmit={importLink}><label className="link-input"><Link2 size={19} /><input value={url} onChange={e => setUrl(e.target.value)} placeholder="Incolla un link Spotify o YouTube" aria-label="Link Spotify o YouTube" /></label><button className="primary" disabled={!url.trim()} type="submit"><Download size={17} /> Importa</button></form>{error && <div className="error"><CircleAlert size={18} />{error}<button onClick={() => setError('')} aria-label="Chiudi errore">×</button></div>}
      <div className="content">{selected === 'network' ? <Network onPlay={track => setActive(key(track))} onRemoteTracks={setRemoteTracks} /> : <><header className={`content-head ${playlist ? 'is-playlist' : 'is-library'}`}><div className="hero-cover"><Cover playlist={playlist} large /></div><div className="collection-details"><span className="eyebrow">{playlist ? 'PLAYLIST' : 'LIBRERIA LOCALE'}</span><h1>{playlist?.titolo || 'La tua musica'}</h1><p>{playlist ? `${playlist.numero_canzoni} brani · ${Math.round(playlist.lunghezza_minuti)} minuti` : `${allTracks.length} brani sul dispositivo`}</p><div className="collection-actions">
  <button className="primary" disabled={!display.length} onClick={() => setActive(key(display[0]))}><Play size={16} fill="currentColor" /> Riproduci</button>
  {playlist && <>
    <button className="secondary" onClick={() => setEditing(playlist)}><Pencil size={16} /> Modifica</button>
    <button className="secondary" disabled={sharing} onClick={() => void sharePlaylist(playlist)}><Share2 size={16} /> {sharing ? "Creazione ZIP…" : "Condividi ZIP"}</button>
    <button className="secondary delete-trigger" onClick={() => setDeleting(playlist)}><Trash2 size={16} /> Elimina</button>
  </>}
</div></div></header>
{shareNotice && playlist && <div className="share-notice" role="status"><strong>{shareNotice.name} pronto</strong><span>Archivio senza ricodifica audio, salvato in:</span><code>{shareNotice.path}</code><button className="secondary" onClick={() => void navigator.clipboard.writeText(shareNotice.path).catch(() => setError("Impossibile copiare il percorso."))}><Copy size={15} /> Copia percorso</button></div>}<div className="library-tools"><h2>{playlist ? 'Brani della playlist' : 'Tutti i brani'}</h2><label className="search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cerca brani o artisti" aria-label="Cerca nella libreria" /></label></div>{filtered.length ? <div className="track-table"><div className="track-head"><span>#</span><span>Titolo</span><span>Artista</span><span>Durata</span><span>Disponibilità</span><span /></div>{filtered.map((track, index) => <div className="track-row" key={key(track)} onDoubleClick={() => setActive(key(track))}><span className="number">{index + 1}</span><div className="track-title"><Cover track={track} /><button onClick={() => setActive(key(track))}>{track.title}</button></div><span className="artist">{track.artist || '—'}</span><span>{time(track.duration)}</span><span className="available"><Check size={15} /> Locale</span><button className="row-action" onClick={() => setTransfer(track)} title="Sposta o copia brano" aria-label={`Organizza ${track.title}`}><MoreVertical size={18} /></button></div>)}</div> : <div className="empty"><Music2 size={40} /><h2>{query ? 'Nessun risultato' : 'La libreria è vuota'}</h2><p>{query ? 'Prova un altro titolo o artista.' : 'Incolla un link Spotify o YouTube in alto per iniziare.'}</p></div>}</>}</div>
    </div><Player tracks={active?.startsWith("remote/") ? remoteTracks : allTracks} active={active} setActive={setActive} /><JobsDock jobs={jobs} onDownload={async id => { try { await api(`/api/jobs/${id}/download`, { method: 'POST' }); setJobs((await api<{ jobs: ImportJob[] }>('/api/jobs')).jobs) } catch (failure) { setError(errorMessage(failure)) } }} dismissed={dismissed} onDismiss={id => setDismissed(items => [...items, id])} />{transfer && <TransferDialog track={transfer} playlists={library.playlists} onClose={() => setTransfer(null)} onSubmit={submitTransfer} />}{editing && <PlaylistEditor playlist={editing} onClose={() => setEditing(null)} onSave={savePlaylist} />}{deleting && <DeletePlaylistDialog playlist={deleting} onClose={() => setDeleting(null)} onDelete={deletePlaylist} />}</div>
}
