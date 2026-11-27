import { createRoot } from 'react-dom/client'
import App from './App'
import WindowFrame from './WindowFrame'
import { errorMessage, startDesktopBackend } from './backend'
import './style.css'
import './retro.css'
import './visual-themes.css'

const container = document.getElementById('root')
if (!container) throw new Error('Elemento principale mancante.')
const root = createRoot(container)
root.render(<WindowFrame><div className="boot-screen">Avvio di ReePlay…</div></WindowFrame>)
startDesktopBackend()
  .then(() => root.render(<WindowFrame><App /></WindowFrame>))
  .catch(error => root.render(<WindowFrame><div className="boot-screen"><h1>Impossibile avviare ReePlay</h1><p>{errorMessage(error)}</p></div></WindowFrame>))
