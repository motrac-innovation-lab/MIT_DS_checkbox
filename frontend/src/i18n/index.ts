import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from './languages'

import commonNl from './locales/nl/common.json'
import authNl from './locales/nl/auth.json'
import commonEn from './locales/en/common.json'
import authEn from './locales/en/auth.json'

// Elke namespace staat hier met de hand geregistreerd. Kleine JSON-bestanden
// die Vite rechtstreeks meebundelt, dus geen async laden en geen <Suspense>.
// Een namespace toevoegen: twee JSON-bestanden, twee imports, twee regels
// hieronder. Een TAAL toevoegen: zie languages.ts.
export const resources = {
  nl: {
    common: commonNl,
    auth: authNl,
  },
  en: {
    common: commonEn,
    auth: authEn,
  },
} as const

export const defaultNS = 'common'

function opgeslagenTaal(): string {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE
  let opgeslagen: string | null = null
  try {
    opgeslagen = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  } catch {
    // Safari private mode kan ook op lezen gooien, niet alleen op schrijven.
  }
  // Regio-suffix eraf in plaats van de waarde afwijzen: een oude "en-GB" in de
  // opslag hoort op Engels uit te komen, niet stilletjes op Nederlands.
  const basis = opgeslagen?.split('-')[0].toLowerCase() ?? null
  return basis && SUPPORTED_LANGUAGES.some((l) => l.code === basis) ? basis : DEFAULT_LANGUAGE
}

void i18n.use(initReactI18next).init({
  resources,
  // Starttaal, synchroon uit localStorage. Een eerste bezoeker krijgt
  // Nederlands, ongeacht zijn browsertaal — bewuste keuze uit de gids.
  lng: opgeslagenTaal(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
  load: 'languageOnly',
  defaultNS,
  // React escapet zelf al alles wat het rendert; i18nexts eigen escaping erbij
  // zou apostroffen en ampersands dubbel escapen.
  interpolation: { escapeValue: false },
})

/** Wisselt de actieve taal en onthoudt hem op dit apparaat. */
export function setLanguage(code: string): void {
  // Valideren vóór het wegschrijven: anders blijft een niet-ondersteunde code
  // in de opslag staan en werkt hij door tot de volgende herlaadbeurt.
  const volgende = SUPPORTED_LANGUAGES.some((l) => l.code === code) ? code : DEFAULT_LANGUAGE
  void i18n.changeLanguage(volgende)
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, volgende)
  } catch {
    // Quota vol of private mode: de taal is wél gewisseld voor deze sessie,
    // hij overleeft alleen geen herlaadbeurt.
  }
}

// <html lang> meebewegen: schermlezers en de vertaalprompt van de browser lezen
// dat allebei, en niets anders werkt het bij bij een client-side wissel.
if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng
  })
}

export default i18n
