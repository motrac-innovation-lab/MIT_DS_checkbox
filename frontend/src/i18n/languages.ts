// De enige bron van waarheid voor welke talen deze app aanbiedt.
// Alles in de app itereert deze lijst, dus een taal toevoegen vereist
// nergens anders een wijziging aan de kiezer.
export interface Taal {
  code: string
  label: string
}

// De volgorde telt twee keer: het is de volgorde van de rijen in de dropdown,
// EN waar de kiezer op terugvalt als de actieve taal niet te herleiden is.
// SUPPORTED_LANGUAGES[0] en DEFAULT_LANGUAGE moeten het eens zijn.
//
// De labels zijn endoniemen ("Nederlands", niet "Dutch") en worden bewust NIET
// vertaald per actieve taal. Nooit door t() halen.
export const SUPPORTED_LANGUAGES: Taal[] = [
  { code: 'nl', label: 'Nederlands' },
  { code: 'en', label: 'English' },
]

export const DEFAULT_LANGUAGE = 'nl'

// Voorkeur per apparaat. Genamespaced op deze app, zodat twee apps op dezelfde
// hostname niet om één sleutel vechten.
export const LANGUAGE_STORAGE_KEY = 'mit-ds-checkbox-language'
