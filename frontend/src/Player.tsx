import { useEffect, useRef, useState } from 'react'
import { Music2, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import type { Track } from './types'
import { trackKey, trackUrl } from './tracks'

const time = (seconds?: number): string => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`

export default function Player({ tracks, active, setActive }: { tracks: Track[]; active: string | null; setActive: (value: string) => void }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(.8)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [artFailed, setArtFailed] = useState(false)
  const [audioFailed, setAudioFailed] = useState(false)
  const index = tracks.findIndex(track => trackKey(track) === active)
  const track = tracks[index]

  useEffect(() => {
    if (!track || !audio.current) return
    audio.current.load()
    audio.current.volume = volume
    audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    setCurrent(0)
    setArtFailed(false)
    setAudioFailed(false)
  }, [active])

  const step = (delta: number) => {
    if (!tracks.length) return
    const nextIndex = shuffle && tracks.length > 1
      ? (index + 1 + Math.floor(Math.random() * (tracks.length - 1))) % tracks.length
      : (index + delta + tracks.length) % tracks.length
    const nextKey = trackKey(tracks[nextIndex])
    if (nextKey === active && audio.current) {
      audio.current.currentTime = 0
      audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else setActive(nextKey)
  }
  const toggle = () => {
    if (!track || !audio.current) return
    if (audio.current.paused) audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    else { audio.current.pause(); setPlaying(false) }
  }
  const ended = () => {
    if (repeat && audio.current) { audio.current.currentTime = 0; audio.current.play().catch(() => setPlaying(false)) }
    else if (tracks.length > 1) step(1)
    else setPlaying(false)
  }
  const art = track && trackUrl(track, 'art')
  return <div className="player">
    <audio ref={audio} src={track ? trackUrl(track, 'media') : undefined} onTimeUpdate={event => setCurrent(event.currentTarget.currentTime)} onLoadedMetadata={event => setDuration(event.currentTarget.duration)} onEnded={ended} onPause={() => setPlaying(false)} onError={() => { setPlaying(false); setAudioFailed(true) }} />
    <div className="now"><div className="cover">{art && !artFailed ? <img src={art} alt="" onError={() => setArtFailed(true)} /> : <Music2 size={24} />}</div><div><strong>{track?.title || 'Nessun brano in riproduzione'}</strong><span>{audioFailed ? 'Brano non disponibile: controlla la connessione' : track?.artist || 'Seleziona un brano'}</span></div></div>
    <div className="player-center"><div className="transport"><button className={shuffle ? 'active' : ''} onClick={() => setShuffle(value => !value)} aria-label="Riproduzione casuale" aria-pressed={shuffle}><Shuffle size={17} /></button><button onClick={() => step(-1)} disabled={!track} aria-label="Precedente"><SkipBack size={18} fill="currentColor" /></button><button className="play-main" onClick={toggle} disabled={!track} aria-label={playing ? 'Pausa' : 'Riproduci'}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button><button onClick={() => step(1)} disabled={!track} aria-label="Successivo"><SkipForward size={18} fill="currentColor" /></button><button className={repeat ? 'active' : ''} onClick={() => setRepeat(value => !value)} aria-label="Ripeti brano" aria-pressed={repeat}><Repeat2 size={17} /></button></div><div className="seek"><span>{time(current)}</span><input aria-label="Posizione" type="range" min="0" max={duration || 1} value={Math.min(current, duration || 1)} onChange={event => { if (audio.current) audio.current.currentTime = Number(event.target.value); setCurrent(Number(event.target.value)) }} /><span>{time(duration || track?.duration)}</span></div></div>
    <div className="volume"><Volume2 size={18} /><input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={event => { const value = Number(event.target.value); setVolume(value); if (audio.current) audio.current.volume = value }} /></div>
  </div>
}
