import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { join, resourceDir } from '@tauri-apps/api/path'
import { Command } from '@tauri-apps/plugin-shell'

let backendOrigin = ''

export function apiUrl(path: string): string {
  return `${backendOrigin}${path}`
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), options)
  const data: unknown = await response.json()
  if (!response.ok) {
    const detail = typeof data === 'object' && data !== null && 'detail' in data
      ? String(data.detail) : 'Operazione non riuscita'
    throw new Error(detail)
  }
  return data as T
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function startDesktopBackend(): Promise<void> {
  if (!isTauri()) return

  const toolsDir = await join(await resourceDir(), 'bundled-tools')
  const command = Command.sidecar('binaries/musicapp-backend', [], {
    processGroup: true,
    env: { MUSICAPP_TOOLS_DIR: toolsDir },
  })
  const announcedPort = new Promise<number>((resolve, reject) => {
    command.stdout.on('data', line => {
      const match = /^MUSICAPP_PORT=(\d+)\s*$/.exec(line.trim())
      if (match) resolve(Number(match[1]))
    })
    command.on('error', reject)
    command.on('close', () => reject(new Error('Il motore musicale si è chiuso prima dell’avvio.')))
  })
  const child = await command.spawn()
  try {
    const port = await Promise.race([
      announcedPort,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Il motore musicale non si è avviato.')), 15000)),
    ])
    backendOrigin = `http://127.0.0.1:${port}`
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(apiUrl('/api/status'))
        if (response.ok) break
      } catch { /* The Python process is still starting. */ }
      if (attempt === 39) throw new Error('Il motore musicale non risponde.')
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  } catch (error) {
    await child.kill()
    throw error
  }

  try {
    const currentWindow = getCurrentWindow()
    await currentWindow.onCloseRequested(event => {
      event.preventDefault()
      void Promise.race([
        child.kill(),
        new Promise<void>(resolve => setTimeout(resolve, 2000)),
      ]).finally(() => currentWindow.destroy()).catch(() => undefined)
    })
  } catch (error) {
    await child.kill()
    throw error
  }
}
