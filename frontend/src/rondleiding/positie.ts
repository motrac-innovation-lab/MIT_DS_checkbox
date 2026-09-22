// Waar komt de tekstballon van de rondleiding te staan? Bewust pure functies
// zonder React en zonder DOM: dit is het enige rekenwerk in de module, en zo is
// het met de hand na te lopen. De frontend van deze app heeft geen test-runner
// (de backend wel), dus er is hier geen vangnet dat een rekenfout eruit haalt.
//
// Overgenomen uit `motrac-toegangsbeheer/src/rondleiding/positie.js` — de
// tweede app in de vloot met een rondleiding — en alleen naar TypeScript
// vertaald. Wijkt er iets af, dan staat het bij de betreffende regel.

/** Rechthoek in viewport-coördinaten, zoals `getBoundingClientRect()` hem geeft. */
export interface Rechthoek {
  top: number
  left: number
  width: number
  height: number
}

/** Breedte/hoogte van de viewport, of van de ballon zelf. */
export interface Maat {
  breedte: number
  hoogte: number
}

export type Zijde = 'boven' | 'onder' | 'links' | 'rechts' | 'gecentreerd'

/** Voorkeurszijde van een stap; 'auto' kiest de eerste die past. */
export type Plaatsing = 'auto' | 'boven' | 'onder' | 'links' | 'rechts'

export interface Positie {
  top: number
  left: number
  zijde: Zijde
}

/** Ruimte tussen ballon en anker, en tussen ballon en schermrand. */
export const MARGE = 12

/**
 * Onder deze breedte plakt de ballon onderaan het scherm — naast een element
 * past dan toch niets. Gelijk aan `BP_KAART` uit @motrac/template-ui (768): dat
 * is de grens waarop deze app al op kaartweergave overgaat
 * (`useKaartWeergave()` in GeschiedenisPage), en de rondleiding hoort niet een
 * eigen omslagpunt te hebben dat daar tien pixels naast zit.
 *
 * Als getal en niet geïmporteerd uit het pakket: dit bestand hoort DOM-vrij en
 * importvrij te blijven (zie de kop), en `BP_KAART` importeren trekt via de
 * pakket-index React en `style.css` mee.
 */
export const SMAL_SCHERM = 768

/**
 * Eerste zijde die past. Volgorde: onder -> boven -> rechts -> links, tenzij de
 * stap een voorkeur opgeeft; die schuift dan vooraan. Past er niets, dan
 * 'gecentreerd' — de ballon overlapt het anker dan mogelijk, maar valt nooit
 * buiten beeld.
 */
export function kiesZijde(anker: Rechthoek, tip: Maat, viewport: Maat, voorkeur: Plaatsing = 'auto'): Zijde {
  const volgorde: Zijde[] = ['onder', 'boven', 'rechts', 'links']
  if (voorkeur !== 'auto' && volgorde.includes(voorkeur)) {
    volgorde.splice(volgorde.indexOf(voorkeur), 1)
    volgorde.unshift(voorkeur)
  }
  for (const zijde of volgorde) {
    if (zijde === 'onder' && viewport.hoogte - (anker.top + anker.height) >= tip.hoogte + MARGE * 2) return 'onder'
    if (zijde === 'boven' && anker.top >= tip.hoogte + MARGE * 2) return 'boven'
    if (zijde === 'rechts' && viewport.breedte - (anker.left + anker.width) >= tip.breedte + MARGE * 2) return 'rechts'
    if (zijde === 'links' && anker.left >= tip.breedte + MARGE * 2) return 'links'
  }
  return 'gecentreerd'
}

/** Houdt een waarde tussen min en max; bij een te krappe ruimte wint min. */
export function klem(waarde: number, min: number, max: number): number {
  return Math.max(min, Math.min(waarde, Math.max(min, max)))
}

/**
 * Boven- of onderaan plakken op een smal scherm. Onderaan is de standaard —
 * daar is de ballon het dichtst bij de duim — maar een anker in de ONDERSTE
 * schermhelft verdwijnt er juist achter. Op een telefoon is dat geen randgeval
 * maar de gewone stand: de zijbalk van AppShell wordt daar de tabbalk onderaan,
 * en de navigatiestap wijst precies daarnaar (gemeten op 390px: het anker staat
 * op y 712-758 van 780, de ballon op 528-768).
 */
export function smalleZijde(anker: Rechthoek | null, viewport: Maat): 'boven' | 'onder' {
  if (!anker) return 'onder'
  return anker.top + anker.height / 2 > viewport.hoogte / 2 ? 'boven' : 'onder'
}

/**
 * Definitieve positie van de ballon, altijd binnen de viewport. `anker` mag
 * null zijn: dan komt de ballon midden in beeld te staan (de intro-, resultaat-
 * en slotstap hebben geen anker).
 */
export function balonPositie(anker: Rechthoek | null, tip: Maat, viewport: Maat, voorkeur: Plaatsing = 'auto'): Positie {
  const gecentreerd: Positie = {
    top: klem((viewport.hoogte - tip.hoogte) / 2, MARGE, viewport.hoogte - tip.hoogte - MARGE),
    left: klem((viewport.breedte - tip.breedte) / 2, MARGE, viewport.breedte - tip.breedte - MARGE),
    zijde: 'gecentreerd',
  }
  if (!anker) return gecentreerd

  const zijde = kiesZijde(anker, tip, viewport, voorkeur)
  if (zijde === 'gecentreerd') return gecentreerd

  let top: number
  let left: number
  if (zijde === 'onder' || zijde === 'boven') {
    top = zijde === 'onder' ? anker.top + anker.height + MARGE : anker.top - tip.hoogte - MARGE
    left = anker.left + anker.width / 2 - tip.breedte / 2
  } else {
    top = anker.top + anker.height / 2 - tip.hoogte / 2
    left = zijde === 'rechts' ? anker.left + anker.width + MARGE : anker.left - tip.breedte - MARGE
  }
  return {
    top: klem(top, MARGE, viewport.hoogte - tip.hoogte - MARGE),
    left: klem(left, MARGE, viewport.breedte - tip.breedte - MARGE),
    zijde,
  }
}
