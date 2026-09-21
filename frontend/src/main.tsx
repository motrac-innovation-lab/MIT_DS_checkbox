// BESCHERMD (zie CLAUDE.md): de provider-volgorde en de twee stylesheet-imports
// zijn de basis uit motrac-template-ui / de fleet — niet zonder toestemming
// aanpassen.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from '@motrac/template-ui'
// Side-effect import: initialiseert de i18next-singleton synchroon vóór de
// eerste render (zie src/i18n/index.ts).
import './i18n'
import App from './App'
import { AuthProvider } from './context/AuthContext'
// De gedeelde stylesheet van het pakket éérst, daarna pas de app-eigen CSS —
// die mag alleen aanvullen, nooit een klasse van het pakket herdefiniëren.
import '@motrac/template-ui/style.css'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
