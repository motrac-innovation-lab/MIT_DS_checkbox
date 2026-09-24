import type { Plaatsing } from './positie'

// De rondleiding als DATA: één lijst stappen, geen JSX. Een stap toevoegen is
// daardoor één regel hier + twee sleutels in beide vertaalbestanden (+ zo nodig
// één `data-rondleiding`-attribuut in het scherm zelf).
//
// Overgenomen uit `motrac-toegangsbeheer/src/rondleiding/stappen.js`, dat het
// op zijn beurt uit `mit-salessupport` haalde — de eerste app in de vloot met
// een rondleiding. Wat daar geleerd is, staat hier ook: stappen als data,
// ankers op ONZE eigen markup, en nooit vastlopen op een anker dat er niet is.
//
// `anker` is een gewone CSS-selector. Meestal `[data-rondleiding="…"]` op een
// element dat wij zelf plaatsen. Daarnaast is `a[href="/<tab>"]` toegestaan
// voor de navigatie: die links komen uit `AppShell` (template-ui) en daar
// kunnen wij geen attribuut in zetten, maar het pad ÍS van ons — het staat in
// `tabs` in App.tsx. Altijd `optioneel`, want op een smal scherm zit het item
// achter de hamburger en bestaat de link niet.
//
// Een klasse van @motrac/template-ui is BEWUST geen geldig anker: die markup
// mag bij een pakketupdate wijzigen, en dan verdwijnt de uitleg stilletjes.
// Voor knoppen is dat geen beperking — `Button` geeft onbekende props door aan
// de echte `<button>` (geverifieerd in template-ui 0.10.0,
// `src/components/Button.tsx`: `<button className={…} {...rest}>`), dus
// `data-rondleiding` mag rechtstreeks op `<Button>`. Op `<Card>` juist NIET:
// die destructureert alleen `title`/`icon`/`action`/`children` en laat de rest
// vallen, dus daar hoort een wikkeldiv omheen.

/**
 * Onderdeel van de app waar een stap bij hoort. De kaart op /rondleiding laat
 * je hier beginnen, zodat iemand die alleen het logboek moet kennen niet eerst
 * de hele conversie door hoeft.
 */
export type RondleidingGroep = 'start' | 'converteren' | 'logboek'

export interface RondleidingStap {
  /** Uniek; tegelijk de i18n-subsleutel (`stap.<id>.titel` / `.tekst`). */
  id: string
  groep: RondleidingGroep
  /** Tabpad waar deze stap thuishoort (`/converteren`, `/geschiedenis`, …). */
  route: string
  /** CSS-selector, of null voor een gecentreerde tekstkaart. */
  anker: string | null
  /** Anker mag ontbreken -> stap overslaan i.p.v. gecentreerd tonen. */
  optioneel?: boolean
  /** Voorkeurszijde van de ballon; 'auto' kiest de eerste die past. */
  plaatsing?: Plaatsing
  /** Alleen tonen voor de rol `admin` (session.role in AuthContext). */
  alleenAdmin?: boolean
}

// Volgorde = de volgorde waarin je de app leert kennen: eerst wat iedereen hier
// komt doen (een offerte omzetten), dan pas het logboek dat alleen een
// beheerder ziet. Een gewone gebruiker is na zeven stappen klaar; een
// beheerder krijgt er drie bij (serverstatus, logboek, beeldbank).
//
// LET OP het formaat: `scripts/check-rondleiding.mjs` leest dit bestand als
// TEKST (Node kan geen TypeScript importeren op de Node 20 van de deploy-job).
// Elke stap is daarom één plat object-literal met enkele aanhalingstekens.
// Wijkt een regel van dat formaat af, dan valt de check hard om met een
// melding — hij slaat nooit stilletjes een stap over.
export const STAPPEN: RondleidingStap[] = [
  // ---- Iedereen: waar ben ik ----------------------------------------------
  { id: 'welkom', groep: 'start', route: '/converteren', anker: null },
  // De zijbalk komt uit AppShell; zie de toelichting bovenaan waarom dit een
  // href-selector is en waarom hij optioneel moet zijn.
  { id: 'navigatie', groep: 'start', route: '/converteren', anker: 'a[href="/converteren"]', optioneel: true, plaatsing: 'rechts' },

  // ---- Iedereen: een offerte omzetten --------------------------------------
  // De statuskaart staat alleen voor een beheerder op het scherm (zie
  // ConversiePage), dus deze stap ook. Voor een gewone gebruiker begint de
  // groep `converteren` vanzelf bij `upload`.
  { id: 'serverstatus', groep: 'converteren', route: '/converteren', anker: '[data-rondleiding="conversie-status"]', alleenAdmin: true },
  { id: 'upload', groep: 'converteren', route: '/converteren', anker: '[data-rondleiding="conversie-upload"]' },
  { id: 'starten', groep: 'converteren', route: '/converteren', anker: '[data-rondleiding="conversie-knop"]', plaatsing: 'boven' },
  // GEEN anker, en dat is opzet: het resultaatblok bestaat pas ná een echte
  // conversie, en tijdens een rondleiding vangt de overlay elke klik af — er
  // valt dus per definitie niets aan te wijzen. Een optionele stap zou bij
  // vrijwel iedereen worden overgeslagen en de uitleg over wat je terugkrijgt
  // zou nooit gelezen worden; een verplichte stap zou eerst anderhalve
  // seconde naar een verduisterd scherm laten staren. Een gecentreerde kaart
  // vertelt het gewoon, altijd, meteen.
  { id: 'resultaat', groep: 'converteren', route: '/converteren', anker: null },

  // ---- Beheerder: het conversielogboek -------------------------------------
  { id: 'geschiedenis', groep: 'logboek', route: '/geschiedenis', anker: '[data-rondleiding="geschiedenis-lijst"]', alleenAdmin: true },
  { id: 'beeldbank', groep: 'logboek', route: '/beeldbank', anker: '[data-rondleiding="beeldbank-upload"]', alleenAdmin: true },

  // ---- Iedereen: afsluiten -------------------------------------------------
  // Geen anker: het Support-label hangt `position:fixed` tegen de rechterrand
  // en is markup van het pakket (`.fb-tab`), en op mobiel bestaat het helemaal
  // niet — daar zit Support achter de hamburger. Een gecentreerde kaart legt
  // beide gevallen in één keer uit.
  { id: 'feedbackGeven', groep: 'start', route: '/rondleiding', anker: null },
  // De slotstap wijst de kaart aan waarmee je de rondleiding opnieuw start:
  // daar hoort hij te eindigen, want dat is het adres om hem terug te vinden.
  { id: 'slot', groep: 'start', route: '/rondleiding', anker: '[data-rondleiding="kaart"]' },
]

/** De stappen die deze rol te zien krijgt. */
export function stappenVoorRol(isAdmin: boolean): RondleidingStap[] {
  return STAPPEN.filter((s) => !s.alleenAdmin || isAdmin)
}

/** Index van de eerste stap van een groep, of -1 als die groep er voor deze rol niet is. */
export function eersteStapVanGroep(stappen: RondleidingStap[], groep: RondleidingGroep): number {
  return stappen.findIndex((s) => s.groep === groep)
}

/**
 * De groepen die deze rol te zien krijgt, in volgorde van voorkomen. Voedt de
 * knoppenrij op /rondleiding, dus hij mag geen groep noemen waar voor deze rol
 * geen enkele stap in zit.
 */
export function groepenVoorRol(isAdmin: boolean): RondleidingGroep[] {
  const gezien: RondleidingGroep[] = []
  for (const s of stappenVoorRol(isAdmin)) {
    if (!gezien.includes(s.groep)) gezien.push(s.groep)
  }
  return gezien
}
