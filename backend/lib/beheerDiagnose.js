// Beoordeelt wat Motrac-beheer terugstuurt op de /verify-call van
// GET /api/_health/beheer.
//
// WAAROM DIT BESTAAT
//
// Die route keek alleen naar de statuscode: 200 betekende "koppeling werkt".
// Op 2026-09-22 stond MOTRAC_BEHEER_URL op `https://portaal.motrac.app` — de
// WEBPAGINA van Motrac-beheer, niet de API. Die host serveert op élk pad de
// SPA, dus ook op /api/v1/<slug>/verify, met status 200 en een HTML-body. De
// diagnose meldde daardoor "koppeling werkt" terwijl authenticate() bij elk
// verzoek HTML kreeg, `payload.active` altijd undefined was en de hele app
// 401's gaf. De browser klaagde tegelijk over een ontbrekende
// Access-Control-Allow-Origin, wat de aandacht naar de CORS-allowlist trok —
// die wél goed stond. Deze route bestaat juist om zo'n verkeerd spoor te
// voorkomen, dus hij hoort te kijken naar WAT er terugkomt.
//
// De API antwoordt altijd met JSON: een geldige sleutel plus een ongeldig
// token geeft `{"active":false}`, een verkeerde sleutel geeft 401 met
// `{"error":{"code":"INVALID_API_KEY"}}`. Allebei bewijzen dat de URL klopt.

const JSON_TYPE = /^application\/(?:[\w.+-]+\+)?json\b/i

/**
 * @param {{ status: number, contentType: string | null, body: string }} antwoord
 * @returns {{ oordeel: string, bruikbaar: boolean }}
 *   `bruikbaar`: praat deze URL werkelijk de API van Motrac-beheer?
 */
export function beoordeelBeheerAntwoord({ status, contentType, body }) {
  const isJson = JSON_TYPE.test(contentType ?? '') || /^\s*[[{]/.test(body ?? '')

  if (!isJson) {
    return {
      bruikbaar: false,
      oordeel:
        'MOTRAC_BEHEER_URL wijst NIET naar de API van Motrac-beheer: er komt geen JSON terug maar een webpagina. '
        + 'Dit is het adres van de inlogpagina in plaats van dat van de API. Zolang dit zo staat mislukt élke '
        + 'tokencontrole en geeft de hele app 401, terwijl de browser tegelijk over CORS klaagt.',
    }
  }

  // 401 INVALID_API_KEY is nog steeds de juiste URL — alleen de sleutel klopt niet.
  if (status === 401 && /INVALID_API_KEY/i.test(body ?? '')) {
    return {
      bruikbaar: true,
      oordeel: 'de URL klopt, maar MOTRAC_VERIFY_KEY wordt door Motrac-beheer geweigerd — controleer de API-key van deze app in AppManager.',
    }
  }

  if (status === 404) {
    return {
      bruikbaar: false,
      oordeel: 'de API antwoordt, maar kent deze slug niet — controleer APP_SLUG in server.js tegen de slug in AppManager.',
    }
  }

  if (status >= 200 && status < 300) {
    return { bruikbaar: true, oordeel: 'koppeling werkt (een 401 op gewone routes komt dan door het token zelf).' }
  }

  return { bruikbaar: false, oordeel: `koppeling faalt met status ${status} — dit verklaart de 401 op alles.` }
}
