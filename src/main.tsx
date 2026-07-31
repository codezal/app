import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@xterm/xterm/css/xterm.css'
import App from './App.tsx'
import { installHttpNoiseFilter } from './lib/http-noise'
import { installGlobalErrorReporter } from './lib/report'
// Monaco Editor worker + tema kurulumu (import side-effect: loader.config({monaco})).
import './lib/monaco/setup'

installHttpNoiseFilter()

installGlobalErrorReporter()

if (import.meta.env.PROD) {
  window.addEventListener('contextmenu', (e) => e.preventDefault())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
