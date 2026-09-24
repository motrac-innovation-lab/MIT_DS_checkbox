// Lettertypenamen in de DOCX omzetten naar een naam die LibreOffice vindt —
// zie lettertypeAliassen() in lettertypen.js voor het waarom. Kort: het
// document vraagt `DaxPro-Bold`, fontconfig kent alleen familie "DaxPro" met
// stijl Bold, en zonder deze stap wordt het NotoSans.
//
// Per `<w:rPr>` (runs, alineamarkeringen, stijlen, docDefaults): staat in
// `w:ascii` of `w:hAnsi` een naam uit de aliaslijst, dan krijgen alle
// rFonts-attributen met die naam de familie, en gaan vet/cursief aan als de
// snit dat is. Een expliciet `<w:b w:val="0"/>` wordt dan `<w:b/>`: in Word is
// "DaxPro-Bold, niet vet" nog steeds de Bold-snit.
import { alsFontconfigNaam } from './lettertypen.js'

const RPR = /<w:rPr>([\s\S]*?)<\/w:rPr>/g
const RFONTS = /<w:rFonts\b[^>]*?\/?>/
const FONT_ATTR = /\bw:(ascii|hAnsi|eastAsia|cs)="([^"]*)"/g
const UIT = /^(?:0|false|off)$/i

/** Zet `<w:b/>` of `<w:i/>` aan in een rPr-inhoud; `na` = de tags waarna hij mag. */
function zetAan(inhoud, tag, na) {
  const bestaand = new RegExp(`<w:${tag}(?=[\\s/>])[^>]*?/>`)
  const m = inhoud.match(bestaand)
  if (m) {
    const val = m[0].match(/\bw:val="([^"]*)"/)?.[1]
    return val !== undefined && UIT.test(val) ? inhoud.replace(m[0], `<w:${tag}/>`) : inhoud
  }
  // Schemavolgorde van rPr: rStyle, rFonts, b, bCs, i, iCs, … — invoegen na
  // de laatste aanwezige voorganger.
  let positie = -1
  for (const voor of na) {
    const v = inhoud.match(new RegExp(`<w:${voor}(?=[\\s/>])[^>]*?/>`))
    if (v) positie = Math.max(positie, v.index + v[0].length)
  }
  if (positie < 0) return `<w:${tag}/>` + inhoud
  return inhoud.slice(0, positie) + `<w:${tag}/>` + inhoud.slice(positie)
}

/**
 * @param {string} xml document/header/footer/styles/numbering
 * @param {Record<string, { familie: string, vet: boolean, cursief: boolean }>} aliassen lettertypeAliassen()
 * @returns {{ xml: string, omgezet: Record<string, number> }} per oorspronkelijke naam het aantal rPr's
 */
export function pasLettertypeAliassenToe(xml, aliassen) {
  const omgezet = {}
  if (!aliassen || !Object.keys(aliassen).length || !xml.includes('<w:rFonts')) return { xml, omgezet }
  const uit = xml.replace(RPR, (blok, inhoud) => {
    const rFonts = inhoud.match(RFONTS)
    if (!rFonts) return blok
    let alias = null
    let origineel = null
    for (const [, attr, naam] of rFonts[0].matchAll(FONT_ATTR)) {
      if ((attr === 'ascii' || attr === 'hAnsi') && aliassen[alsFontconfigNaam(naam)]) {
        alias = aliassen[alsFontconfigNaam(naam)]
        origineel = naam
        break
      }
    }
    if (!alias) return blok
    const nieuweFonts = rFonts[0].replace(FONT_ATTR, (a, attr, naam) =>
      alsFontconfigNaam(naam) === alsFontconfigNaam(origineel) ? `w:${attr}="${alias.familie}"` : a)
    let nieuw = inhoud.replace(rFonts[0], nieuweFonts)
    if (alias.vet) nieuw = zetAan(nieuw, 'b', ['rStyle', 'rFonts'])
    if (alias.cursief) nieuw = zetAan(nieuw, 'i', ['rStyle', 'rFonts', 'b', 'bCs'])
    omgezet[origineel] = (omgezet[origineel] ?? 0) + 1
    return `<w:rPr>${nieuw}</w:rPr>`
  })
  return { xml: uit, omgezet }
}
