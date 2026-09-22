// BESCHERMD (zie CLAUDE.md). Eén auth-client-instantie voor de hele app: zowel
// de AuthProvider (login/sessie/SSO) als lib/api.ts (de Authorization-header
// op eigen /api/*-requests) gebruiken dezelfde instantie — het token leeft in
// een closure in de client, dus twee instanties zouden uit sync lopen.
import { createMotracAuthClient, type AuthTeksten } from '@motrac/auth-client'
import i18n from '../i18n'

// De productie-Motrac-beheer van de fleet (zelfde origin als mit-salessupport
// en de andere apps). Lokaal tegen een eigen Motrac-beheer testen: zet
// VITE_MOTRAC_AUTH_URL=http://localhost:8787 in frontend/.env.
const DEFAULT_ORIGIN = 'https://9x24841z85.dev.motrac.app'
// De slug van deze app in Motrac-beheer (toegekend 2026-09-22). Terugval voor
// het geval VITE_MOTRAC_AUTH_SLUG ontbreekt; moet gelijk zijn aan APP_SLUG in
// backend/server.js en aan VITE_MOTRAC_AUTH_SLUG in CI.
const DEFAULT_SLUG = 'esigntool'

const ORIGIN = import.meta.env.VITE_MOTRAC_AUTH_URL || DEFAULT_ORIGIN
const SLUG = import.meta.env.VITE_MOTRAC_AUTH_SLUG || DEFAULT_SLUG
const SSO_AUTOSTART = String(import.meta.env.VITE_SSO_AUTOSTART ?? '').toLowerCase() !== 'off'

export const motracAuthClient = createMotracAuthClient({
  origin: ORIGIN,
  slug: SLUG,
  ssoAutostart: SSO_AUTOSTART,
  // Als functie (lazy): de melding volgt de taal die actief is op het moment
  // van de fout. Zelfde bedrading als mit-salessupport/motrac-restlast.
  teksten: () => i18n.t('common:authClient', { returnObjects: true }) as Partial<AuthTeksten>,
})

export const getStoredToken = motracAuthClient.getStoredToken
export const clearToken = motracAuthClient.clearToken
