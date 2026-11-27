import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, CircleAlert, Computer, Headphones, Link2, Music2, Play, RefreshCw, Search, ShieldCheck, Wifi, WifiOff } from 'lucide-react'
import { api, apiUrl, errorMessage } from './backend'
import { trackKey, trackUrl } from './tracks'
import type { Library, Track } from './types'

interface Peer { id: string; name: string; host: string; port: number }
interface Candidate extends Peer { fingerprint: string }
interface NetworkStatus { enabled: boolean; port: number | null; name: string; addresses: string[]; fingerprint: string | null; code: string | null; clients: { id: string; name: string }[]; peers: Peer[] }
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const time = (seconds: number): string => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`
const fingerprint = (value: string): string => value.match(/.{1,8}/g)?.join(' ') || value

function RemoteCover({ track }: { track: Track }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [track.remote, track.playlist, track.file])
  return <div className="cover">{failed ? <Music2 size={18} /> : <img src={trackUrl(track, 'art')} alt="" loading="lazy" onError={() => setFailed(true)} />}</div>
}

export default function Network({ onPlay, onRemoteTracks }: { onPlay: (track: Track) => void; onRemoteTracks: (tracks: Track[]) => void }) {
  const [status, setStatus] = useState<NetworkStatus | null>(null)
  const [devices, setDevices] = useState<Candidate[]>([])
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [code, setCode] = useState('')
  const [verified, setVerified] = useState(false)
  const [openPeer, setOpenPeer] = useState<Peer | null>(null)
  const [remoteLibrary, setRemoteLibrary] = useState<Library | null>(null)
  const [selectedPlaylist, setSelectedPlaylist] = useState('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => setStatus(await api<NetworkStatus>('/api/network/status'))
  useEffect(() => {
    void refresh().catch(e => setError(errorMessage(e)))
    const timer = setInterval(() => { void refresh().catch(() => undefined) }, 5000)
    return () => clearInterval(timer)
  }, [])

  async function action(name: string, run: () => Promise<void>) {
    setBusy(name); setError('')
    try { await run() } catch (e) { setError(errorMessage(e)) } finally { setBusy('') }
  }

  const discover = () => action('discover', async () => { const result = await api<{ devices: Candidate[] }>('/api/network/discover'); setDevices(result.devices); await refresh() })
  const rename = () => {
    const title = window.prompt('Nome visibile nella rete locale:', status?.name || '')
    if (!title?.trim()) return
    void action('rename', async () => setStatus(await api<NetworkStatus>('/api/network/name', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })))
  }
  const inspect = (address: string, number: number) => action('inspect', async () => {
    const result = await api<Candidate>('/api/network/inspect', json({ host: address, port: number }))
    setCandidate(result); setVerified(false); setCode('')
  })
  const connect = () => action('connect', async () => {
    if (!candidate) return
    const peer = await api<Peer>('/api/network/connect', json({ host: candidate.host, port: candidate.port, fingerprint: candidate.fingerprint, code }))
    setCandidate(null); setCode(''); setVerified(false)
    await refresh(); await open(peer)
  })
  const open = async (peer: Peer) => {
    setOpenPeer(peer); setRemoteLibrary(null); setSelectedPlaylist('all'); setQuery('')
    const catalog = await api<Library>(`/api/network/peers/${encodeURIComponent(peer.id)}/library`)
    const marked = { playlists: catalog.playlists.map(item => ({ ...item, tracks: item.tracks.map(track => ({ ...track, remote: peer.id })) })), singles: catalog.singles.map(track => ({ ...track, remote: peer.id })) }
    setRemoteLibrary(marked)
    onRemoteTracks([...marked.singles, ...marked.playlists.flatMap(item => item.tracks)])
  }
  const tracks = useMemo(() => remoteLibrary
    ? selectedPlaylist === 'all' ? [...remoteLibrary.singles, ...remoteLibrary.playlists.flatMap(item => item.tracks)]
      : remoteLibrary.playlists.find(item => item.id === selectedPlaylist)?.tracks || []
    : [], [remoteLibrary, selectedPlaylist])
  const filtered = tracks.filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(query.toLowerCase()))

  return <div className="network-page">
    <div className="network-heading"><span className="eyebrow">MUSICA TRA COMPUTER</span><h1>Rete Locale</h1><p>Ascolta le librerie dei PC collegati alla stessa rete. I brani rimangono sul computer che li condivide.</p></div>
    {error && <div className="network-alert"><CircleAlert size={17} />{error}<button onClick={() => setError('')} aria-label="Chiudi">×</button></div>}
    <section className="network-panel"><div className="network-panel-head"><div className="network-symbol"><Computer size={24} /></div><div><h2>Questo PC</h2><p>{status?.name || 'Caricamento…'}</p></div><button className="network-text-button" disabled={!status || !!busy} onClick={rename}>Rinomina</button><button className={status?.enabled ? 'secondary' : 'primary'} disabled={!status || !!busy} onClick={() => action('share', async () => setStatus(await api<NetworkStatus>(status?.enabled ? '/api/network/stop' : '/api/network/start', { method: 'POST' })))}>{status?.enabled ? <><WifiOff size={16} /> Interrompi</> : <><Wifi size={16} /> Condividi libreria</>}</button></div>
      {status?.enabled ? <div className="network-sharing"><p><span className="status-dot" /> Libreria condivisa · {status.addresses[0] ? `${status.addresses[0]}:${status.port}` : `porta ${status.port}`}</p>{status.addresses.length > 1 && <details className="network-other-addresses"><summary>Altri indirizzi di rete</summary>{status.addresses.slice(1).map(address => <span key={address}>{address}:{status.port}</span>)}</details>}<div className="network-pair"><button className="secondary" disabled={!!busy} onClick={() => action('code', async () => setStatus(await api<NetworkStatus>('/api/network/code', { method: 'POST' })))}>Genera codice di associazione</button>{status.code && <strong className="pair-code">{status.code} <small>valido 5 minuti, una sola volta</small></strong>}</div><p className="network-fingerprint"><ShieldCheck size={16} /> Impronta da confrontare sull’altro PC: <code>{fingerprint(status.fingerprint || '')}</code></p>{status.clients.length > 0 && <div className="network-clients"><h3>Dispositivi autorizzati</h3>{status.clients.map(client => <div key={client.id}><span>{client.name}</span><button onClick={() => action('revoke', async () => setStatus(await api<NetworkStatus>(`/api/network/clients/${encodeURIComponent(client.id)}`, { method: 'DELETE' })))}>Revoca</button></div>)}</div>}</div> : <p className="network-hint">La libreria è privata. Attiva la condivisione soltanto quando vuoi ascoltarla da un altro PC.</p>}
    </section>

    <section className="network-panel"><div className="network-panel-head"><div className="network-symbol"><Wifi size={24} /></div><div><h2>Computer nella rete</h2><p>Apri un PC già associato oppure cercane uno vicino.</p></div><button className="secondary" disabled={!!busy} onClick={discover}><RefreshCw size={16} /> {busy === 'discover' ? 'Ricerca…' : 'Cerca'}</button></div>
      <div className="network-devices">{status?.peers.map(peer => <div className="network-device" key={peer.id}><Computer size={20} /><div><strong>{peer.name}</strong><span>{peer.host}:{peer.port} · Associato</span></div><button className="primary" disabled={!!busy} onClick={() => action('open', () => open(peer))}>Apri</button><button className="network-text-button" onClick={() => action('forget', async () => { setStatus(await api<NetworkStatus>(`/api/network/peers/${encodeURIComponent(peer.id)}`, { method: 'DELETE' })); if (openPeer?.id === peer.id) { setOpenPeer(null); setRemoteLibrary(null); onRemoteTracks([]) } })}>Rimuovi</button></div>)}{devices.filter(device => !status?.peers.some(peer => peer.id === device.id)).map(device => <div className="network-device" key={device.id}><Computer size={20} /><div><strong>{device.name}</strong><span>{device.host}:{device.port} · Da associare</span></div><button className="secondary" disabled={!!busy} onClick={() => inspect(device.host, device.port)}>Connetti</button></div>)}{!status?.peers.length && !devices.length && <p className="network-hint">Nessun computer trovato. Premi Cerca oppure inserisci l’indirizzo mostrato sull’altro PC.</p>}</div>
      <form className="network-manual" onSubmit={(event: FormEvent) => { event.preventDefault(); void inspect(host.trim(), Number(port)) }}><Link2 size={17} /><label>Indirizzo IP<input value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.10" required /></label><label>Porta<input value={port} onChange={e => setPort(e.target.value)} inputMode="numeric" placeholder="54321" required /></label><button className="secondary" disabled={!!busy} type="submit">Connetti</button></form>
    </section>

    {candidate && <section className="network-panel network-confirm"><h2>Associa {candidate.name}</h2><p>Confronta questa impronta con quella mostrata nella sezione Rete Locale del PC che condivide la musica.</p><code>{fingerprint(candidate.fingerprint)}</code><label className="network-checkbox"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /> Le impronte coincidono</label><label className="network-code-input">Codice visualizzato sull’altro PC<input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="000000" /></label><div className="network-confirm-actions"><button className="primary" disabled={!verified || code.length !== 6 || !!busy} onClick={connect}>Associa PC</button><button className="secondary" onClick={() => setCandidate(null)}>Annulla</button></div></section>}

    {openPeer && <section className="network-panel network-library"><div className="network-panel-head"><div className="network-symbol"><Headphones size={24} /></div><div><span className="eyebrow">IN RETE · {openPeer.name}</span><h2>La musica di {openPeer.name}</h2><p>{remoteLibrary ? `${tracks.length} brani disponibili` : busy === 'open' || busy === 'reload' || busy === 'connect' ? 'Caricamento della libreria…' : 'Libreria non disponibile. Premi Aggiorna.'}</p></div><button className="secondary" disabled={!!busy} onClick={() => action('reload', () => open(openPeer))}><RefreshCw size={16} /> Aggiorna</button></div>{remoteLibrary && <><div className="network-playlists"><button className={selectedPlaylist === 'all' ? 'selected' : ''} onClick={() => setSelectedPlaylist('all')}>Tutti i brani</button>{remoteLibrary.playlists.map(item => <button className={selectedPlaylist === item.id ? 'selected' : ''} key={item.id} onClick={() => setSelectedPlaylist(item.id)}>{item.cover_version ? <img src={apiUrl(`/api/network/peers/${encodeURIComponent(openPeer.id)}/cover/${encodeURIComponent(item.id)}`)} alt="" /> : <Music2 size={18} />}{item.titolo}</button>)}</div><label className="search network-search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cerca brani o artisti" /></label>{filtered.length ? <div className="track-table"><div className="track-head"><span>#</span><span>Titolo</span><span>Artista</span><span>Durata</span><span>Disponibilità</span><span /></div>{filtered.map((track, index) => <div className="track-row" key={trackKey(track)} onDoubleClick={() => onPlay(track)}><span className="number">{index + 1}</span><div className="track-title"><RemoteCover track={track} /><button onClick={() => onPlay(track)}>{track.title}</button></div><span className="artist">{track.artist || '—'}</span><span>{time(track.duration)}</span><span className="available"><Check size={15} /> In rete</span><button className="row-action" onClick={() => onPlay(track)} aria-label={`Riproduci ${track.title}`}><Play size={16} /></button></div>)}</div> : <p className="network-hint">Nessun brano in questa selezione.</p>}</>}</section>}
  </div>
}
