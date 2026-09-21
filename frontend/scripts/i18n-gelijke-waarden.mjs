// scripts/i18n-gelijke-waarden.mjs — de sleutels waar NL en EN terecht
// identiek zijn.
//
// check-i18n-values.mjs meldt elke sleutel waarvan de Engelse waarde letterlijk
// gelijk is aan de Nederlandse: dat is meestal een sleutel die wél gekopieerd
// maar nooit vertaald is. Soms is het juist goed — eigennamen, vaktermen die in
// beide talen hetzelfde zijn ("Support", "Bug"), labels uit een externe
// interface. Zo'n geval hoort HIER te staan, met een bewuste keuze erachter.
// Staat een sleutel hier terwijl de waarden inmiddels verschillen, dan meldt de
// check dat ook: deze lijst mag niet stilletjes verouderen.
export const GELIJKE_WAARDEN = [
  // "Motrac · Sales offerte converter" is de merknaam plus de app-naam;
  // die vertalen we niet.
  'auth:sub',
  'common:app.titel',
  // Het label van het feedback-onderdeel heet sinds template-ui 0.9.0
  // "Support" — in beide talen hetzelfde woord.
  'common:ui.feedback',
  'common:ui.feedbackGeven',
  'common:ui.feedbackTypeLabel',
  'common:ui.feedbackTypeBug',
  'common:nav.home',
  'common:rollen.admin',
]
