import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@xterm/xterm/css/xterm.css'
import App from './App.tsx'
import { installHttpNoiseFilter } from './lib/http-noise'
import { installGlobalErrorReporter } from './lib/report'
// Monaco setup artık lazy: CodeEditor ilk mount olduğunda yüklenir (main bundle'dan ~4 MB çıkar).

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
