import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import iconUrl from '../app-icon.svg'

const appWindow = isTauri() ? getCurrentWindow() : null

export default function WindowFrame({ children }: { children: ReactNode }) {
  const [frameless, setFrameless] = useState(() => !!appWindow && navigator.userAgent.includes('Windows'))
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!appWindow) return
    let active = true
    let unlisten: (() => void) | undefined
    const updateMaximized = () => {
      void appWindow.isMaximized().then(value => { if (active) setMaximized(value) }).catch(() => undefined)
    }
    void appWindow.isDecorated().then(value => { if (active) setFrameless(!value) }).catch(() => undefined)
    updateMaximized()
    void appWindow.onResized(updateMaximized).then(dispose => {
      if (active) unlisten = dispose
      else dispose()
    }).catch(() => undefined)
    return () => { active = false; unlisten?.() }
  }, [])

  if (!frameless || !appWindow) return <>{children}</>

  const toggleMaximize = () => {
    void appWindow.toggleMaximize()
      .then(() => appWindow.isMaximized())
      .then(setMaximized)
      .catch(() => undefined)
  }

  const dragOrMaximize = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    if (event.detail === 2) toggleMaximize()
    else void appWindow.startDragging().catch(() => undefined)
  }

  return <div className="desktop-frame">
    <header className="window-titlebar" onMouseDown={dragOrMaximize}>
      <div className="window-titlebar-brand"><img src={iconUrl} alt="" /><span>ReePlay</span></div>
      <div className="window-titlebar-space" />
      <div className="window-titlebar-controls">
        <button type="button" aria-label="Minimizza" title="Minimizza" onClick={() => void appWindow.minimize()}><Minus size={17} /></button>
        <button type="button" aria-label={maximized ? 'Ripristina' : 'Ingrandisci'} title={maximized ? 'Ripristina' : 'Ingrandisci'} onClick={toggleMaximize}>{maximized ? <Copy size={14} /> : <Square size={14} />}</button>
        <button type="button" className="window-titlebar-close" aria-label="Chiudi" title="Chiudi" onClick={() => void appWindow.close()}><X size={18} /></button>
      </div>
    </header>
    {children}
  </div>
}
