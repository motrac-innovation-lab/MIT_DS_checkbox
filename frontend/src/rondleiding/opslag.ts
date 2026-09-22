// Waar de rondleiding onthoudt hoe ver een gebruiker is en of hij vanzelf mag
// starten. Bewust `localStorage` en geen kolom in de database: het is een
// voorkeur van één persoon op één apparaat, geen bedrijfsgegeven, en een
// vlaggetje op de server zou hier een migratie, een route en een veld in de
// bootstrap kosten.
//
// Wél per gebruiker gescoped binnen die ene sleutel. Deze app draait ook op
// gedeelde pc's in de verkoopbinnendienst, en de rondleiding van je collega
// hoort niet die van jou te zijn: zonder scoping zou de tweede medewerker op
// zo'n pc de rondleiding nooit te zien krijgen.
//
// De sleutel volgt `LANGUAGE_STORAGE_KEY` uit i18n/languages.ts: voorvoegsel
// `mit-ds-checkbox-`. Zelfde try/catch-patroon als daar: Safari's private mode
// gooit al bij het LEZEN, en dat mag de app nooit omvertrekken.

const OPSLAG_SLEUTEL = 'mit-ds-checkbox-rondleiding'

// Verhoog dit zodra de rondleiding zo ingrijpend wijzigt dat iedereen hem weer
// zou moeten zien: een oudere versie telt dan als "nog niet gezien".
export const RONDLEIDING_VERSIE = 1

export type RondleidingStatus = 'afgerond' | 'overgeslagen'

export interface RondleidingVoortgang {
  versie: number
  /** null = nog nooit afgesloten (dus ook nog nooit gestart). */
  status: RondleidingStatus | null
  /** Bij welke stap iemand stopte, voor "verdergaan waar je gebleven was". */
  stap: string | null
  /** Mag de rondleiding bij een eerste bezoek vanzelf starten? */
  automatisch: boolean
}

const LEEG: RondleidingVoortgang = { versie: RONDLEIDING_VERSIE, status: null, stap: null, automatisch: true }

function alles(): Record<string, Partial<RondleidingVoortgang>> {
  if (typeof window === 'undefined') return {}
  try {
    const ruw = localStorage.getItem(OPSLAG_SLEUTEL)
    if (!ruw) return {}
    const geparsed: unknown = JSON.parse(ruw)
    return geparsed && typeof geparsed === 'object' ? (geparsed as Record<string, Partial<RondleidingVoortgang>>) : {}
  } catch {
    // Onleesbaar of geblokkeerd: doen alsof er niets staat. De rondleiding
    // start dan hooguit één keer te vaak — dat is de goede kant om op te falen.
    return {}
  }
}

/**
 * Wat er voor deze gebruiker bewaard is. Nooit null: een gebruiker zonder (of
 * met een verouderde) regel krijgt de standaardstand terug, zodat elke
 * aanroeper hetzelfde vorm-object heeft.
 */
export function leesVoortgang(gebruikerSleutel: string): RondleidingVoortgang {
  const bewaard = alles()[gebruikerSleutel]
  if (!bewaard || bewaard.versie !== RONDLEIDING_VERSIE) return LEEG
  return {
    versie: bewaard.versie,
    status: bewaard.status ?? null,
    stap: bewaard.stap ?? null,
    // Ontbreekt de sleutel (regel van vóór dit veld), dan is aan de standaard.
    automatisch: bewaard.automatisch !== false,
  }
}

/** Werkt alleen de meegegeven velden bij; de rest blijft staan. */
export function bewaarVoortgang(gebruikerSleutel: string, patch: Partial<RondleidingVoortgang>): void {
  if (typeof window === 'undefined') return
  try {
    const bestaand = alles()
    const huidig = leesVoortgang(gebruikerSleutel)
    bestaand[gebruikerSleutel] = { ...huidig, ...patch, versie: RONDLEIDING_VERSIE }
    localStorage.setItem(OPSLAG_SLEUTEL, JSON.stringify(bestaand))
  } catch {
    // Geen opslag beschikbaar: de rondleiding werkt gewoon, hij onthoudt alleen
    // niets. Voor een voorkeur nooit een foutmelding tonen.
  }
}
