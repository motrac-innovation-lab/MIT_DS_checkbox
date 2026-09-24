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
// DaxPro / DaxPro-Bold / DaxPro-Light / DaxPro-Medium moeten in de PDF
// behouden blijven).
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { leesRelaties, verwijderBedekteVormen } from './verborgenVormen.js'
import { standaardAlineastijl, standaardstijlInTekstvakken } from './tekstvakStijl.js'
import { pasLettertypeAliassenToe } from './lettertypeNamen.js'
import { opvulspatiesNaarRechts } from './opvulspaties.js'
import { sluitGekoppeldeAfbeeldingenIn } from './gekoppeldeAfbeeldingen.js'

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
 * Haalt de `<w:pPr>`-blokken weg. De `<w:rPr>` daarbinnen is de opmaak van de
 * alineamarkering (het ¶-teken zelf), niet van de tekst in de alinea — Word
 * zet daar standaard "Times New Roman" neer. Zie de reden bij
 * lettertypenInOnderdeel(). Een `<w:pPr>` in een `<w:pPrChange>` (wijzigingen
 * bijhouden) maakt de niet-gulzige match korter; wat er dan blijft staan
 * bevat geen `<w:rFonts>` meer, dus dat is onschadelijk.
 */
function zonderAlineaEigenschappen(xml) {
  return xml.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, '')
}

/**
 * Lettertypen die een onderdeel expliciet aanvraagt (`w:rFonts`), plus de
 * stijl-id's die het gebruikt (`w:pStyle`/`w:rStyle`) — die worden in
 * styles.xml nagelopen door verzamelLettertypen().
 *
 * Alleen `w:ascii` en `w:hAnsi` tellen mee, en alleen buiten `<w:pPr>`. Dat is
 * precies wat op het scherm in dat lettertype kán komen te staan; de rest is
 * opmaak die nooit gerenderd wordt en daarmee ook nooit in de PDF belandt —
 * waarna vergelijkLettertypen() hem als "vervangen" zou melden terwijl er
 * niets vervangen is. Gemeten op een echte Motrac-offerte (2026-09-22):
 *   - `w:cs` (complex script, Arabisch/Hebreeuws) leverde Arial, Consolas,
 *     Calibri en Calibri-Bold — geen letter ervan staat in het document;
 *   - `w:eastAsia` (CJK) en de alineamarkering leverden Times New Roman:
 *     62 van de 62 `w:ascii="Times New Roman"` stonden in een `<w:pPr>`.
 * Die vier waren exact de valse meldingen. Word schrijft deze terugvallen in
 * vrijwel elk document, ook als er geen Arabisch, Japans of Times New Roman in
 * voorkomt.
 */
function lettertypenInOnderdeel(xml) {
  const fonts = new Set()
  const stijlen = new Set()
  for (const m of zonderAlineaEigenschappen(xml).matchAll(/<w:rFonts\b([^>]*)\/?>/g)) {
    for (const attr of m[1].matchAll(/\bw:(?:ascii|hAnsi)="([^"]+)"/g)) fonts.add(attr[1].trim())
  }
  // Stijlverwijzingen komen juist wél uit `<w:pPr>` (daar staat `w:pStyle`),
  // dus die lezen we over de onbewerkte XML.
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

/** `word/document.xml` → `word/_rels/document.xml.rels`. */
function relsPad(naam) {
  const i = naam.lastIndexOf('/')
  return `${naam.slice(0, i)}/_rels/${naam.slice(i + 1)}.rels`
}

/** Onderdelen buiten body/kop/voet waar ook lettertypenamen in staan. */
const STIJL_PART = /^word\/(?:styles|numbering)\.xml$/

/**
 * Alleen de lettertypen die het document vraagt — vóór enige omzetting, zonder
 * transformaties of her-zippen. Voor de render-probe (lettertypeProbe.js), die
 * moet weten welke namen het document gebruikt vóórdat de voorbewerking met de
 * gevonden aliassen draait; zo draait voorbewerkDocx() maar één keer. Pakt
 * alleen de XML-onderdelen uit (geen media).
 * @returns {string[]} gesorteerd, zonder symboollettertypen
 */
export function gevraagdeLettertypen(docxBytes) {
  let onderdelen
  try {
    onderdelen = unzipSync(docxBytes instanceof Uint8Array ? docxBytes : new Uint8Array(docxBytes), {
      filter: (f) => isTransformeerbaarWordPart(f.name) || f.name === 'word/styles.xml',
    })
  } catch {
    throw new DocxOngeldig('Het bestand is geen geldig .docx-document (geen leesbaar zip-archief).')
  }
  const gevraagd = new Set()
  const stijlen = new Set()
  for (const [naam, bytes] of Object.entries(onderdelen)) {
    if (!isTransformeerbaarWordPart(naam)) continue
    const gebruikt = lettertypenInOnderdeel(strFromU8(bytes))
    for (const f of gebruikt.fonts) gevraagd.add(f)
    for (const s of gebruikt.stijlen) stijlen.add(s)
  }
  if (onderdelen['word/styles.xml']) {
    for (const f of lettertypenUitStijlen(strFromU8(onderdelen['word/styles.xml']), stijlen)) gevraagd.add(f)
  }
  return [...gevraagd].filter((f) => f && !SYMBOOL_LETTERTYPEN.test(f)).sort((a, b) => a.localeCompare(b, 'nl'))
}

/**
 * Voert de voorbewerking uit op de ruwe DOCX-bytes.
 * @param {Uint8Array} docxBytes
 * @param {{
 *   lettertypeAliassen?: Record<string, { familie: string, vet: boolean, cursief: boolean }>,
 *   afbeeldingen?: Record<string, Uint8Array>,
 * }} [opties]
 *   `lettertypeAliassen`: uit lettertypeAliassen() over de fontbestanden van
 *   deze server — namen die LibreOffice anders niet vindt (zie lettertypeNamen.js).
 *   `afbeeldingen`: zoekAfbeeldingen().gevonden — gekoppelde afbeeldingen die
 *   hier alsnog ingesloten worden (zie gekoppeldeAfbeeldingen.js).
 * @returns {{ docx: Uint8Array, vervangingen: number, vormenVerwijderd: number, tekstvakAlineas: number, opvulAlineas: number, lettertypenOmgezet: Record<string, number>, afbeeldingenIngesloten: number, lettertypen: string[] }}
 *   `opvulAlineas`: tabelcel-alinea's waarvan de opvulspaties zijn vervangen door
 *   rechts uitlijnen (zie opvulspaties.js).
 *   `lettertypenOmgezet`: per omgezette naam het aantal opmaakblokken.
 *   `tekstvakAlineas`: alinea's in een tekstvak die de standaardstijl expliciet
 *   kregen, zodat LibreOffice er niet de docDefaults op zet (zie tekstvakStijl.js).
 *   `vormenVerwijderd`: vormen die in Word volledig onder een dekkende vorm
 *   liggen en daarom uit het document zijn gehaald (zie verborgenVormen.js).
 *   `lettertypen`: de door het document gevraagde lettertypen, gesorteerd en
 *   zonder symboollettertypen.
 */
export function voorbewerkDocx(docxBytes, { lettertypeAliassen = {}, afbeeldingen = {} } = {}) {
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
  let vormenVerwijderd = 0
  let tekstvakAlineas = 0
  let opvulAlineas = 0
  const lettertypenOmgezet = {}
  const aliassen = (xml) => {
    const r = pasLettertypeAliassenToe(xml, lettertypeAliassen)
    for (const [naam, n] of Object.entries(r.omgezet)) lettertypenOmgezet[naam] = (lettertypenOmgezet[naam] ?? 0) + n
    return r.xml
  }
  const standaardStijl = onderdelen['word/styles.xml'] ? standaardAlineastijl(strFromU8(onderdelen['word/styles.xml'])) : null
  const gevraagd = new Set()
  const stijlen = new Set()

  for (const [naam, bytes] of Object.entries(onderdelen)) {
    // Mapvermeldingen ("word/") zijn geen bestanden; een zip zonder ze is even geldig.
    if (naam.endsWith('/')) continue
    if (isTransformeerbaarWordPart(naam)) {
      const rels = onderdelen[relsPad(naam)]
      const zichtbaar = verwijderBedekteVormen(strFromU8(bytes), leesRelaties(rels ? strFromU8(rels) : ''))
      vormenVerwijderd += zichtbaar.verwijderd
      const gestyled = standaardstijlInTekstvakken(zichtbaar.xml, standaardStijl)
      tekstvakAlineas += gestyled.aangepast
      const rechts = opvulspatiesNaarRechts(gestyled.xml)
      opvulAlineas += rechts.aangepast
      const resultaat = transformeerDocumentXml(aliassen(rechts.xml))
      vervangingen += resultaat.vervangingen
      uitvoer[naam] = strToU8(resultaat.xml)
      const gebruikt = lettertypenInOnderdeel(resultaat.xml)
      for (const f of gebruikt.fonts) gevraagd.add(f)
      for (const s of gebruikt.stijlen) stijlen.add(s)
    } else if (STIJL_PART.test(naam) && Object.keys(lettertypeAliassen).length) {
      uitvoer[naam] = strToU8(aliassen(strFromU8(bytes)))
    } else {
      uitvoer[naam] = bytes
    }
  }

  const afbeeldingenIngesloten = sluitGekoppeldeAfbeeldingenIn(uitvoer, afbeeldingen, { lees: strFromU8, schrijf: strToU8 })

  // Na de omzetting gelezen: de vergelijking met de PDF gaat over wat
  // LibreOffice gevraagd wordt, niet over de naam die alleen Word kent.
  if (uitvoer['word/styles.xml']) {
    for (const f of lettertypenUitStijlen(strFromU8(uitvoer['word/styles.xml']), stijlen)) gevraagd.add(f)
  }

  const lettertypen = [...gevraagd].filter((f) => f && !SYMBOOL_LETTERTYPEN.test(f)).sort((a, b) => a.localeCompare(b, 'nl'))

  return { docx: zipSync(uitvoer), vervangingen, vormenVerwijderd, tekstvakAlineas, opvulAlineas, lettertypenOmgezet, afbeeldingenIngesloten, lettertypen }
}

export class DocxOngeldig extends Error {
  constructor(message) {
    super(message)
    this.name = 'DocxOngeldig'
  }
}
