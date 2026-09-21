// Voorbewerking van de geüploade DOCX vóór LibreOffice hem rendert — de port
// van `DocxPreprocessor.java` uit het oude repo `esign_motrac`.
//
// Word-documenten uit de configurator markeren een aan te vinken vakje vaak
// als symbool-run `<w:sym w:font="Wingdings 2" w:char="F0A3"/>`. LibreOffice
// rendert dat op Linux via zijn eigen symbool-hercodering (OpenSymbol) en de
// PDF-tekstlaag levert dan U+F0A3 (Private Use Area) op — geen ☐. Daarom
// wordt elke zo'n run hier vervangen door een gewone tekstrun met het
// canonieke ballot-box-teken ☐ (U+2610), zodat de PDF-stap (zie
// pdfCheckboxAnkers.js) altijd één en hetzelfde glyph terugvindt. De
// PDF-stap kent U+F0A3 óók als vangnet, precies zoals de Java-versie.
//
// Naar checkbox-symbolen wordt uitsluitend in de body en in de kop-/
// voetteksten gezocht (word/document.xml, word/header*.xml,
// word/footer*.xml). Daarnaast worden lettertype-aliassen toegepast op elk
// onderdeel dat lettertypen kan noemen (zie LETTERTYPE_PART): een naam die
// in het sjabloon staat maar niet als bestand bestaat, wordt vervangen door
// de naam die er wél is. Alle overige zip-onderdelen gaan byte-voor-byte
// mee, en een onderdeel dat niet daadwerkelijk verandert óók — zodat het
// document geldig blijft en er geen onnodige verschillen ontstaan.
//
// Ten slotte worden de gebruikte lettertypen verzameld, zodat na het
// renderen te controleren is of LibreOffice ze echt gebruikt heeft (de eis
// van Mark: de DaxPro-snitten moeten in de PDF behouden blijven).
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

/** Zip-onderdelen waarin naar checkbox-symbolen gezocht wordt. */
const WORD_PART = /^word\/(?:document|header\d*|footer\d*)\.xml$/

/**
 * Zip-onderdelen waarin lettertype-aliassen worden toegepast: overal waar een
 * `w:rFonts` kan staan. `numbering.xml` hoort er nadrukkelijk bij — daar staat
 * het lettertype van de opsommingstekens, en juist dáár gebruikt het
 * Motrac-sjabloon `LindeDaxOffice` (zie LETTERTYPE_ALIASSEN).
 */
const LETTERTYPE_PART = /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|styles|numbering)\.xml$/

/**
 * Lettertypenamen uit het sjabloon die naar een andere naam moeten wijzen.
 *
 * `LindeDaxOffice` is de naam uit de Linde-huisstijlkit die in
 * `word/numbering.xml` op de opsommingstekens staat. Dat lettertypebestand
 * bestaat niet op de server; het document draagt er zelf zelfs
 * `<w:altName w:val="Calibri"/>` bij, waardoor de bolletjes in Calibri
 * zouden vallen. Mark (2026-09-21): dit moet DaxPro worden.
 *
 * Te overschrijven met de env-var LETTERTYPE_ALIASSEN, als
 * `Oud=Nieuw,Ander=Nieuw`. Een lege waarde zet alle aliassen uit.
 */
export const STANDAARD_ALIASSEN = { LindeDaxOffice: 'DaxPro' }

/** Attributen van `w:rFonts` die een lettertypenaam dragen. */
const RFONTS_ATTRIBUUT = /\bw:(ascii|hAnsi|cs|eastAsia)="([^"]*)"/g

/** Vergelijkbare vorm van een lettertypenaam: "Dax pro" == "DaxPro" == "daxpro". */
const sleutel = (naam) => String(naam ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** De actieve aliassen, met de env-var als overschrijving. */
export function lettertypeAliassen() {
  const ruw = process.env.LETTERTYPE_ALIASSEN
  if (ruw === undefined) return { ...STANDAARD_ALIASSEN }
  const uit = {}
  for (const paar of ruw.split(',')) {
    const [oud, nieuw] = paar.split('=').map((d) => d?.trim())
    if (oud && nieuw) uit[oud] = nieuw
  }
  return uit
}

/**
 * Vervangt in één XML-onderdeel elke `w:rFonts`-verwijzing naar een
 * alias-naam door de doelnaam. Hoofdletters, spaties en streepjes tellen niet
 * mee bij het vergelijken, zodat "Dax pro" en "DaxPro" allebei matchen.
 *
 * Bewust alleen `w:rFonts` en niet `word/fontTable.xml`: die tabel is een
 * beschrijving van de gebruikte lettertypen, geen verwijzing. Hem hernoemen
 * zou een tweede vermelding voor dezelfde naam kunnen opleveren, terwijl hij
 * er voor het renderen niet toe doet zodra geen enkele run er nog naar wijst.
 */
export function pasLettertypeAliassenToe(xml, aliassen) {
  const tabel = new Map(Object.entries(aliassen ?? {}).map(([oud, nieuw]) => [sleutel(oud), nieuw]))
  if (!tabel.size) return { xml, vervangingen: 0 }
  let vervangingen = 0
  const uit = xml.replace(RFONTS_ATTRIBUUT, (heel, attribuut, waarde) => {
    const doel = tabel.get(sleutel(waarde))
    if (!doel || doel === waarde) return heel
    vervangingen++
    return `w:${attribuut}="${doel}"`
  })
  return { xml: uit, vervangingen }
}

export function isLettertypePart(naam) {
  return typeof naam === 'string' && LETTERTYPE_PART.test(naam)
}

/** Waar een checkbox-symboolrun in verandert. xml:space=preserve houdt het glyph intact. */
export const VERVANGING = '<w:t xml:space="preserve">☐</w:t>'

/**
 * De `<w:sym …/>`-varianten die een checkbox voorstellen: Wingdings 2, teken
 * F0A3, in beide attribuutvolgordes en ongeacht hoofd-/kleine letters.
 * Uitbreiden = een patroon toevoegen; bewust NIET breder (zie de test
 * `laatAndereSymbolenStaan`): √ (U+221A) staat in Motrac-offertes in de
 * service-inclusies en is géén checkbox.
 */
const SYM_PATRONEN = [
  /<w:sym\s+w:font="Wingdings 2"\s+w:char="F0A3"\s*\/>/gi,
  /<w:sym\s+w:char="F0A3"\s+w:font="Wingdings 2"\s*\/>/gi,
]

/**
 * Symboollettertypen die nooit in de PDF als "lettertype" terugkomen en dus
 * uit de vergelijking blijven — anders meldt elke offerte een vals "vervangen".
 */
const SYMBOOL_LETTERTYPEN = /^(wingdings.*|webdings|symbol|mt extra|marlett|opensymbol)$/i

export function isTransformeerbaarWordPart(naam) {
  return typeof naam === 'string' && WORD_PART.test(naam)
}

/** Vervangt alle checkbox-symboolruns in één XML-onderdeel. */
export function transformeerDocumentXml(xml) {
  let huidig = xml
  let totaal = 0
  for (const patroon of SYM_PATRONEN) {
    const treffers = huidig.match(patroon)
    if (treffers?.length) {
      huidig = huidig.replace(patroon, VERVANGING)
      totaal += treffers.length
    }
  }
  return { xml: huidig, vervangingen: totaal }
}

/**
 * Lettertypen die een onderdeel expliciet aanvraagt (`w:rFonts`), plus de
 * stijl-id's die het gebruikt (`w:pStyle`/`w:rStyle`) — die worden in
 * styles.xml nagelopen door verzamelLettertypen().
 */
function lettertypenInOnderdeel(xml) {
  const fonts = new Set()
  const stijlen = new Set()
  for (const m of xml.matchAll(/<w:rFonts\b([^>]*)\/?>/g)) {
    for (const attr of m[1].matchAll(/\bw:(?:ascii|hAnsi|cs|eastAsia)="([^"]+)"/g)) fonts.add(attr[1].trim())
  }
  for (const m of xml.matchAll(/<w:(?:pStyle|rStyle)\s+w:val="([^"]+)"/g)) stijlen.add(m[1])
  return { fonts, stijlen }
}

/**
 * Loopt styles.xml na: de documentstandaard (docDefaults) plus elke gebruikte
 * stijl, inclusief de keten van `w:basedOn`. Zo telt "DaxPro" ook mee als hij
 * alleen via de stijl "Standaard" op een alinea staat en niet op de run zelf.
 */
function lettertypenUitStijlen(stylesXml, gebruikteStijlen) {
  const fonts = new Set()
  const docDefaults = stylesXml.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0] ?? ''
  for (const f of lettertypenInOnderdeel(docDefaults).fonts) fonts.add(f)

  const stijlBlokken = new Map()
  for (const m of stylesXml.matchAll(/<w:style\b[^>]*\bw:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    stijlBlokken.set(m[1], m[2])
  }
  const teBezoeken = [...gebruikteStijlen]
  const gezien = new Set()
  while (teBezoeken.length) {
    const id = teBezoeken.pop()
    if (gezien.has(id)) continue
    gezien.add(id)
    const blok = stijlBlokken.get(id)
    if (!blok) continue
    for (const f of lettertypenInOnderdeel(blok).fonts) fonts.add(f)
    const basedOn = blok.match(/<w:basedOn\s+w:val="([^"]+)"/)?.[1]
    if (basedOn) teBezoeken.push(basedOn)
  }
  return fonts
}

/**
 * Voert de voorbewerking uit op de ruwe DOCX-bytes.
 * @returns {{ docx: Uint8Array, vervangingen: number, aliassenToegepast: number, lettertypen: string[] }}
 *   `lettertypen`: de door het document gevraagde lettertypen, gesorteerd en
 *   zonder symboollettertypen, ná het toepassen van de aliassen.
 */
export function voorbewerkDocx(docxBytes) {
  let onderdelen
  try {
    onderdelen = unzipSync(docxBytes instanceof Uint8Array ? docxBytes : new Uint8Array(docxBytes))
  } catch {
    throw new DocxOngeldig('Het bestand is geen geldig .docx-document (geen leesbaar zip-archief).')
  }
  if (!onderdelen['word/document.xml']) {
    throw new DocxOngeldig('Het bestand is geen geldig .docx-document (word/document.xml ontbreekt).')
  }

  const uitvoer = {}
  let vervangingen = 0
  let aliassenToegepast = 0
  const gevraagd = new Set()
  const stijlen = new Set()
  const aliassen = lettertypeAliassen()

  for (const [naam, bytes] of Object.entries(onderdelen)) {
    // Mapvermeldingen ("word/") zijn geen bestanden; een zip zonder ze is even geldig.
    if (naam.endsWith('/')) continue

    const zoekSymbolen = isTransformeerbaarWordPart(naam)
    const zoekLettertypen = isLettertypePart(naam)
    if (!zoekSymbolen && !zoekLettertypen) {
      // Styles, relaties, afbeeldingen, fontTable, custom XML: onaangeroerd.
      uitvoer[naam] = bytes
      continue
    }

    const origineel = strFromU8(bytes)
    let xml = origineel
    if (zoekSymbolen) {
      const resultaat = transformeerDocumentXml(xml)
      xml = resultaat.xml
      vervangingen += resultaat.vervangingen
    }
    if (zoekLettertypen) {
      const resultaat = pasLettertypeAliassenToe(xml, aliassen)
      xml = resultaat.xml
      aliassenToegepast += resultaat.vervangingen
    }
    if (zoekSymbolen) {
      // Ná de aliassen, zodat een hernoemd lettertype ook zo verzameld wordt.
      const gebruikt = lettertypenInOnderdeel(xml)
      for (const f of gebruikt.fonts) gevraagd.add(f)
      for (const s of gebruikt.stijlen) stijlen.add(s)
    }
    // Niet veranderd? Dan de oorspronkelijke bytes, zodat een onderdeel dat
    // we alleen hebben bekeken byte-identiek terugkomt.
    uitvoer[naam] = xml === origineel ? bytes : strToU8(xml)
  }

  if (uitvoer['word/styles.xml']) {
    for (const f of lettertypenUitStijlen(strFromU8(uitvoer['word/styles.xml']), stijlen)) gevraagd.add(f)
  }

  const lettertypen = [...gevraagd].filter((f) => f && !SYMBOOL_LETTERTYPEN.test(f)).sort((a, b) => a.localeCompare(b, 'nl'))

  return { docx: zipSync(uitvoer), vervangingen, aliassenToegepast, lettertypen }
}

export class DocxOngeldig extends Error {
  constructor(message) {
    super(message)
    this.name = 'DocxOngeldig'
  }
}
