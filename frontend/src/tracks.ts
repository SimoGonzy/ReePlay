import { apiUrl } from './backend'
import type { Track } from './types'

export const trackKey = (track: Track): string => `${track.remote ? `remote/${track.remote}/` : ''}${track.playlist || '_singles'}/${track.file}`

export function trackUrl(track: Track, kind: 'media' | 'art'): string {
  const folder = encodeURIComponent(track.playlist || '_singles')
  const file = encodeURIComponent(track.file)
  return apiUrl(track.remote
    ? `/api/network/peers/${encodeURIComponent(track.remote)}/${kind}/${folder}/${file}`
    : `/api/${kind}/${folder}/${file}`)
}
