export interface Track {
  title: string
  artist: string
  duration: number
  file: string
  playlist: string
  remote?: string
}

export interface Playlist {
  id: string
  titolo: string
  numero_canzoni: number
  lunghezza_minuti: number
  link_spotify: string
  cover_version?: number | null
  tracks: Track[]
}

export interface Library {
  playlists: Playlist[]
  singles: Track[]
}

export interface ImportJob {
  id: string
  state: 'searching' | 'ready' | 'downloading' | 'done' | 'error'
  title: string
  total: number
  searched: number
  found: number
  downloaded: number
  missing: string[]
  failed: string[]
  progress: { bytes?: number; total_bytes?: number; eta_seconds?: number }
  current?: string
  estimated_bytes?: number | null
  error?: string
}

export type ThemeColor = 'bg' | 'sidebar' | 'surface' | 'text' | 'muted' | 'border' |
  'accent' | 'accent_text' | 'selected' | 'row_alt' | 'player' | 'danger' | 'positive'

export interface Theme {
  id: string
  name: string
  style: 'flat' | 'glossy'
  colors?: Partial<Record<ThemeColor, string>>
}

export interface Status {
  ffmpeg: boolean
  content: string
}
