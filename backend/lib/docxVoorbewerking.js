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
// Er wordt uitsluitend in de body en in de kop-/voetteksten gezocht
// (word/document.xml, word/header*.xml, word/footer*.xml). Alle andere
// zip-onderdelen (styles, relaties, afbeeldingen, fontTable, …) gaan
// byte-voor-byte mee, zodat het document geldig blijft. Daarnaast worden de
// in het document gebruikte lettertypen verzameld, zodat na het renderen te
// controleren is of LibreOffice ze ook echt gebruikt heeft (de eis van Mark:
// DaxPro / DaxPro-Light / DaxPro-Medium moeten in de PDF behouden blijven).
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

/** Zip-onderdelen die getransformeerd worden; de rest passeert onaangeroerd. */
const WORD_PART = /^word\/(?:document|header\d*|footer\d*)\.xml$/

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
 * @returns {{ docx: Uint8Array, vervangingen: number, lettertypen: string[] }}
 *   `lettertypen`: de door het document gevraagde lettertypen, gesorteerd en
 *   zonder symboollettertypen.
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
  const gevraagd = new Set()
  const stijlen = new Set()

  for (const [naam, bytes] of Object.entries(onderdelen)) {
    // Mapvermeldingen ("word/") zijn geen bestanden; een zip zonder ze is even geldig.
    if (naam.endsWith('/')) continue
    if (isTransformeerbaarWordPart(naam)) {
      const xml = strFromU8(bytes)
      const resultaat = transformeerDocumentXml(xml)
      vervangingen += resultaat.vervangingen
      uitvoer[naam] = strToU8(resultaat.xml)
      const gebruikt = lettertypenInOnderdeel(resultaat.xml)
      for (const f of gebruikt.fonts) gevraagd.add(f)
      for (const s of gebruikt.stijlen) stijlen.add(s)
    } else {
      uitvoer[naam] = bytes
    }
  }

  if (onderdelen['word/styles.xml']) {
    for (const f of lettertypenUitStijlen(strFromU8(onderdelen['word/styles.xml']), stijlen)) gevraagd.add(f)
  }

  const lettertypen = [...gevraagd].filter((f) => f && !SYMBOOL_LETTERTYPEN.test(f)).sort((a, b) => a.localeCompare(b, 'nl'))

  return { docx: zipSync(uitvoer), vervangingen, lettertypen }
}

export class DocxOngeldig extends Error {
  constructor(message) {
    super(message)
    this.name = 'DocxOngeldig'
  }
}
