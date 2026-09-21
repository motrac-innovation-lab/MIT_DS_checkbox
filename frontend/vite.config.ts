import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // BESCHERMD (zie CLAUDE.md): @motrac/template-ui en @motrac/auth-client zijn
    // file:-dependencies — echte symlinks naar ../../motrac-template-ui etc.
    // met hun eigen node_modules. Zonder dedupe bundelt Vite twee losse kopieën
    // van react/react-router-dom (één uit de eigen node_modules, één via de
    // symlink), elk met een eigen React-context. Dat geeft een lege pagina met
    // "Cannot destructure property 'future' of ... useContext(...) as it is
    // null", omdat <NavLink>/<Outlet> uit template-ui een andere
    // react-router-dom-instantie zien dan deze app's <BrowserRouter>.
    // Komt er een nieuwe peer-dependency van het pakket bij, zet hem hier ook.
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
  server: {
    port: 5173,
    // De backend draait als los Node/Express-proces (zie ../backend); de SPA
    // praat er via een absolute URL mee (VITE_API_BASE_URL, zie .env.example),
    // niet via een dev-proxy op hetzelfde origin.
  },
})
