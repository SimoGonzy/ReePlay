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
    const title = window.prompt('Name shown on the local network:', status?.name || '')
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
    <div className="network-heading"><span className="eyebrow">MUSIC ACROSS COMPUTERS</span><h1>Local Network</h1><p>Listen to libraries on PCs connected to the same network. Tracks stay on the computer sharing them.</p></div>
    {error && <div className="network-alert"><CircleAlert size={17} />{error}<button onClick={() => setError('')} aria-label="Close">×</button></div>}
    <section className="network-panel"><div className="network-panel-head"><div className="network-symbol"><Computer size={24} /></div><div><h2>This PC</h2><p>{status?.name || 'Loading…'}</p></div><button className="network-text-button" disabled={!status || !!busy} onClick={rename}>Rename</button><button className={status?.enabled ? 'secondary' : 'primary'} disabled={!status || !!busy} onClick={() => action('share', async () => setStatus(await api<NetworkStatus>(status?.enabled ? '/api/network/stop' : '/api/network/start', { method: 'POST' })))}>{status?.enabled ? <><WifiOff size={16} /> Stop sharing</> : <><Wifi size={16} /> Share library</>}</button></div>
      {status?.enabled ? <div className="network-sharing"><p><span className="status-dot" /> Library shared · {status.addresses[0] ? `${status.addresses[0]}:${status.port}` : `port ${status.port}`}</p>{status.addresses.length > 1 && <details className="network-other-addresses"><summary>Other network addresses</summary>{status.addresses.slice(1).map(address => <span key={address}>{address}:{status.port}</span>)}</details>}<div className="network-pair"><button className="secondary" disabled={!!busy} onClick={() => action('code', async () => setStatus(await api<NetworkStatus>('/api/network/code', { method: 'POST' })))}>Generate pairing code</button>{status.code && <strong className="pair-code">{status.code} <small>valid for 5 minutes, one use</small></strong>}</div><p className="network-fingerprint"><ShieldCheck size={16} /> Fingerprint to compare on the other PC: <code>{fingerprint(status.fingerprint || '')}</code></p>{status.clients.length > 0 && <div className="network-clients"><h3>Authorized devices</h3>{status.clients.map(client => <div key={client.id}><span>{client.name}</span><button onClick={() => action('revoke', async () => setStatus(await api<NetworkStatus>(`/api/network/clients/${encodeURIComponent(client.id)}`, { method: 'DELETE' })))}>Revoke</button></div>)}</div>}</div> : <p className="network-hint">Your library is private. Turn on sharing only when you want to listen from another PC.</p>}
    </section>

    <section className="network-panel"><div className="network-panel-head"><div className="network-symbol"><Wifi size={24} /></div><div><h2>Computers on the network</h2><p>Open a paired PC or search for one nearby.</p></div><button className="secondary" disabled={!!busy} onClick={discover}><RefreshCw size={16} /> {busy === 'discover' ? 'Searching…' : 'Search'}</button></div>
      <div className="network-devices">{status?.peers.map(peer => <div className="network-device" key={peer.id}><Computer size={20} /><div><strong>{peer.name}</strong><span>{peer.host}:{peer.port} · Paired</span></div><button className="primary" disabled={!!busy} onClick={() => action('open', () => open(peer))}>Open</button><button className="network-text-button" onClick={() => action('forget', async () => { setStatus(await api<NetworkStatus>(`/api/network/peers/${encodeURIComponent(peer.id)}`, { method: 'DELETE' })); if (openPeer?.id === peer.id) { setOpenPeer(null); setRemoteLibrary(null); onRemoteTracks([]) } })}>Remove</button></div>)}{devices.filter(device => !status?.peers.some(peer => peer.id === device.id)).map(device => <div className="network-device" key={device.id}><Computer size={20} /><div><strong>{device.name}</strong><span>{device.host}:{device.port} · Not paired</span></div><button className="secondary" disabled={!!busy} onClick={() => inspect(device.host, device.port)}>Connect</button></div>)}{!status?.peers.length && !devices.length && <p className="network-hint">No computers found. Select Search or enter the address shown on the other PC.</p>}</div>
      <form className="network-manual" onSubmit={(event: FormEvent) => { event.preventDefault(); void inspect(host.trim(), Number(port)) }}><Link2 size={17} /><label>IP address<input value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.10" required /></label><label>Port<input value={port} onChange={e => setPort(e.target.value)} inputMode="numeric" placeholder="54321" required /></label><button className="secondary" disabled={!!busy} type="submit">Connect</button></form>
    </section>

    {candidate && <section className="network-panel network-confirm"><h2>Pair with {candidate.name}</h2><p>Compare this fingerprint with the one shown in the sharing PC's Local Network section.</p><code>{fingerprint(candidate.fingerprint)}</code><label className="network-checkbox"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /> The fingerprints match</label><label className="network-code-input">Code shown on the other PC<input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="000000" /></label><div className="network-confirm-actions"><button className="primary" disabled={!verified || code.length !== 6 || !!busy} onClick={connect}>Pair PC</button><button className="secondary" onClick={() => setCandidate(null)}>Cancel</button></div></section>}

    {openPeer && <section className="network-panel network-library"><div className="network-panel-head"><div className="network-symbol"><Headphones size={24} /></div><div><span className="eyebrow">ON THE NETWORK · {openPeer.name}</span><h2>{openPeer.name}'s music</h2><p>{remoteLibrary ? `${tracks.length} tracks available` : busy === 'open' || busy === 'reload' || busy === 'connect' ? 'Loading library…' : 'Library unavailable. Select Refresh.'}</p></div><button className="secondary" disabled={!!busy} onClick={() => action('reload', () => open(openPeer))}><RefreshCw size={16} /> Refresh</button></div>{remoteLibrary && <><div className="network-playlists"><button className={selectedPlaylist === 'all' ? 'selected' : ''} onClick={() => setSelectedPlaylist('all')}>All tracks</button>{remoteLibrary.playlists.map(item => <button className={selectedPlaylist === item.id ? 'selected' : ''} key={item.id} onClick={() => setSelectedPlaylist(item.id)}>{item.cover_version ? <img src={apiUrl(`/api/network/peers/${encodeURIComponent(openPeer.id)}/cover/${encodeURIComponent(item.id)}`)} alt="" /> : <Music2 size={18} />}{item.titolo}</button>)}</div><label className="search network-search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tracks or artists" /></label>{filtered.length ? <div className="track-table"><div className="track-head"><span>#</span><span>Title</span><span>Artist</span><span>Duration</span><span>Availability</span><span /></div>{filtered.map((track, index) => <div className="track-row" key={trackKey(track)} onDoubleClick={() => onPlay(track)}><span className="number">{index + 1}</span><div className="track-title"><RemoteCover track={track} /><button onClick={() => onPlay(track)}>{track.title}</button></div><span className="artist">{track.artist || '—'}</span><span>{time(track.duration)}</span><span className="available"><Check size={15} /> On network</span><button className="row-action" onClick={() => onPlay(track)} aria-label={`Play ${track.title}`}><Play size={16} /></button></div>)}</div> : <p className="network-hint">No tracks in this selection.</p>}</>}</section>}
  </div>
}
