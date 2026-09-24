// Lettertypen voor de DOCX→PDF-render — de eis van Mark (2026-09-21): een
// geüploade offerte in DaxPro / DaxPro-Bold / DaxPro-Light / DaxPro-Medium
// moet in de PDF
// hetzelfde lettertype houden.
//
// LibreOffice kan een lettertype alleen gebruiken als het bestand ervoor
// beschikbaar is. Op het serverpark kunnen we niets systeembreed installeren,
// maar LibreOffice leest óók de map `user/fonts` in zijn gebruikersprofiel —
// en de conversie maakt per aanroep een eigen, tijdelijk profiel (zie
// docxNaarPdf.js). Elke *.ttf/*.otf uit de mappen hieronder wordt daar per
// conversie in gekopieerd. Geen root, geen fontconfig-configuratie, geen
// deploy-afhankelijkheid: alleen bestanden in een map.
//
// Mappen (bestaande worden gebruikt, de rest stil overgeslagen):
//   - FONTS_DIR (komma-gescheiden) als die env-var gezet is, anders
//   - backend/fonts/ (meegeleverd in de deploy-boom, zie scripts/build.mjs)
//   - /uploads/fonts (persistente opslag van het platform — handig om de
//     DaxPro-bestanden buiten git te houden; zie fonts/README.md)
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * De families die een Motrac-offerte gebruikt; de statuspagina meldt welke
 * ontbreken. DaxPro-Bold staat er sinds 2026-09-22 bij: op de gemeten offerte
 * zet hij 52 runs zichtbare tekst, dus zonder dat bestand valt LibreOffice
 * terug en verschuift de layout — de statuskaart hoort dat vooraf te melden en
 * niet pas als resultaat van een conversie.
 */
export const VEREISTE_LETTERTYPEN = ['DaxPro', 'DaxPro-Bold', 'DaxPro-Light', 'DaxPro-Medium']

const FONT_EXTENSIES = /\.(ttf|otf|ttc)$/i

export function fontMappen() {
  const env = process.env.FONTS_DIR?.trim()
  return env
    ? env.split(',').map((m) => path.resolve(m.trim())).filter(Boolean)
    : [path.join(backendDir, 'fonts'), '/uploads/fonts']
}

/**
 * Alle lettertypebestanden uit de fontmappen, mét de familienamen uit hun
 * name-tabel, zodat de status "DaxPro-Light aanwezig" op de familienaam kan
 * rusten en niet op een toevallige bestandsnaam.
 * @returns {Promise<{ bestand: string, pad: string, families: string[], postscript: string[], snitten: object[] }[]>}
 */
export async function beschikbareLettertypen() {
  const gevonden = []
  for (const map of fontMappen()) {
    let namen
    try {
      namen = await readdir(map)
    } catch {
      continue
    }
    for (const naam of namen.sort()) {
      if (!FONT_EXTENSIES.test(naam)) continue
      const pad = path.join(map, naam)
      try {
        if (!(await stat(pad)).isFile()) continue
        const { families, postscript, snitten } = leesNamen(await readFile(pad))
        gevonden.push({ bestand: naam, pad, families, postscript, snitten })
      } catch (e) {
        // Een kapot fontbestand mag de conversie niet tegenhouden; wel melden.
        console.warn(`Lettertype ${pad} is niet leesbaar en wordt overgeslagen:`, e?.message ?? e)
      }
    }
  }
  return gevonden
}

/**
 * Familienamen (nameID 1 en 16) en PostScript-namen (nameID 6) uit de
 * OpenType 'name'-tabel. Bewust zelf geschreven: het is ~50 regels en spaart
 * een dependency uit voor iets wat alleen de statuspagina voedt.
 */
export function leesNamen(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const families = new Set()
  const postscript = new Set()
  const snitten = []
  const tag = data.readUInt32BE(0)
  // TrueType Collection: elk lettertype apart nalopen.
  const offsets = tag === 0x74746366 /* 'ttcf' */
    ? Array.from({ length: data.readUInt32BE(8) }, (_, i) => data.readUInt32BE(12 + i * 4))
    : [0]
  for (const basis of offsets) {
    const snit = {}
    leesNameTabel(data, basis, families, postscript, snit)
    snitten.push(snit)
  }
  return { families: [...families], postscript: [...postscript], snitten }
}

/**
 * @param {object} snit krijgt per lettertype de eerste waarde van nameID 1
 *   (familie), 2 (stijl), 6 (PostScript), 16/17 (typografische familie/stijl)
 */
function leesNameTabel(data, basis, families, postscript, snit = {}) {
  const aantalTabellen = data.readUInt16BE(basis + 4)
  for (let i = 0; i < aantalTabellen; i++) {
    const record = basis + 12 + i * 16
    if (data.toString('latin1', record, record + 4) !== 'name') continue
    const tabel = data.readUInt32BE(record + 8)
    const aantal = data.readUInt16BE(tabel + 2)
    const stringsOffset = tabel + data.readUInt16BE(tabel + 4)
    for (let j = 0; j < aantal; j++) {
      const r = tabel + 6 + j * 12
      const platform = data.readUInt16BE(r)
      const nameId = data.readUInt16BE(r + 6)
      if (![1, 2, 6, 16, 17].includes(nameId)) continue
      const lengte = data.readUInt16BE(r + 8)
      const begin = stringsOffset + data.readUInt16BE(r + 10)
      if (begin + lengte > data.length) continue
      // Windows (3) en Unicode (0) zijn UTF-16BE; Macintosh (1) is in de praktijk ASCII.
      const tekst = platform === 1
        ? data.toString('latin1', begin, begin + lengte)
        : utf16be(data.subarray(begin, begin + lengte))
      const schoon = tekst.replace(/\0/g, '').trim()
      if (!schoon) continue
      snit[nameId] ??= schoon
      if (nameId === 6) postscript.add(schoon)
      else if (nameId === 1 || nameId === 16) families.add(schoon)
    }
    return
  }
}

function utf16be(bytes) {
  let s = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
  return s
}

/**
 * Vergelijkbare vorm van een lettertypenaam: zonder subset-voorvoegsel
 * ("BAAAAA+"), kleine letters, alleen letters en cijfers. Zo matchen
 * "DaxPro-Light" (DOCX), "DaxPro-Light" (PDF BaseFont) en "DaxProLight".
 */
export function normaliseerLettertype(naam) {
  return String(naam ?? '')
    .replace(/^[A-Z]{6}\+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Welke gevraagde lettertypen ontbreken in de PDF (en zijn dus door
 * LibreOffice vervangen). Een gevraagde familie geldt als aanwezig als een
 * PDF-lettertype er gelijk aan is óf ermee begint ("DaxPro" → "DaxPro-Bold"):
 * de PDF noemt het snit-specifieke PostScript-naam, het document de familie.
 *
 * Die vergelijking is bewust éénrichtings. Andersom ("Calibri-Bold" gevraagd,
 * "Calibri" in de PDF) telt als vervangen, en dat moet ook zo blijven: het is
 * exact dezelfde vorm als "DaxPro-Light" gevraagd met alleen "DaxPro" in de
 * PDF, en dát is een echte vervanging die gemeld hoort te worden
 * (VEREISTE_LETTERTYPEN hierboven). Vraagt een document ooit letterlijk om een
 * PostScript-naam als "Calibri-Bold" op zichtbare tekst, dan lost LibreOffice
 * die op naar de familie en volgt hier een melding; in de gemeten Motrac-
 * offertes komt die naam alleen uit w:cs voor en bereikt hij deze functie niet
 * meer (zie docxVoorbewerking.js). Onderscheid tussen een snit-achtervoegsel
 * (Bold/Italic) en een gewicht als eigen familie (Light/Medium) valt niet
 * betrouwbaar uit de naam af te leiden — daarom hier geen heuristiek.
 */
export function vergelijkLettertypen(gevraagd, inPdf) {
  const pdfGenormaliseerd = inPdf.map(normaliseerLettertype)
  const vervangen = gevraagd.filter((naam) => {
    const n = normaliseerLettertype(naam)
    return n && !pdfGenormaliseerd.some((p) => p === n || p.startsWith(n))
  })
  return { gevraagd, inPdf, vervangen }
}

/** Welke van de vereiste families ontbreken in de aangeleverde fontbestanden. */
export function ontbrekendeVereisteLettertypen(bestanden) {
  const aanwezig = bestanden.flatMap((b) => [...b.families, ...b.postscript]).map(normaliseerLettertype)
  return VEREISTE_LETTERTYPEN.filter((v) => {
    const n = normaliseerLettertype(v)
    return !aanwezig.some((a) => a === n)
  })
}

// ---- Namen die LibreOffice niet vindt ------------------------------------------

/**
 * Zoals fontconfig (en dus LibreOffice) een familienaam vergelijkt:
 * hoofdletterongevoelig en zonder spaties — maar een koppelteken telt wél mee.
 * "DaxPro Bold" vindt dus "DaxPro-Bold" niet.
 */
const alsFontconfigNaam = (naam) => String(naam ?? '').toLowerCase().replace(/\s+/g, '')

/**
 * Welke lettertypenamen uit een document LibreOffice NIET als familie vindt,
 * terwijl het bestand er wél is — en waar ze dan naartoe moeten.
 *
 * Aanleiding (2026-09-24, "test_nieuwe_opmaak_26"): het document vraagt op
 * "Datum:", "Offerte:", "Onze referentie:", "Telefoonnummer:" en "John
 * Mestrom" om `DaxPro-Bold`. Word op Windows kent die naam; het
 * DaxPro-Bold-bestand heet voor fontconfig echter familie "DaxPro", stijl
 * Bold — "DaxPro-Bold" is alleen zijn PostScript-naam. LibreOffice vond dus
 * niets en viel terug op NotoSans (breder, dus verspringende tekst), terwijl
 * de statuskaart "DaxPro-Bold aanwezig" meldde (die kijkt ook naar de
 * PostScript-naam). `DaxPro` + vet op dezelfde offerte rendert wél in het
 * DaxPro-Bold-bestand.
 *
 * Alleen PostScript-namen die géén familienaam zijn, en alleen snitten die in
 * DOCX uit te drukken zijn (Regular/Bold/Italic/Bold Italic): een "Light"
 * onder familie "DaxPro" kan een run niet vragen, dus die blijft staan.
 *
 * @param {{ families: string[], snitten?: object[] }[]} bestanden beschikbareLettertypen()
 * @returns {Record<string, { familie: string, vet: boolean, cursief: boolean }>}
 *   sleutel: de naam zoals fontconfig hem vergelijkt (alsFontconfigNaam)
 */
export function lettertypeAliassen(bestanden) {
  const families = new Set(bestanden.flatMap((b) => b.families).map(alsFontconfigNaam))
  const aliassen = {}
  for (const b of bestanden) {
    for (const snit of b.snitten ?? []) {
      const ps = snit[6]
      if (!ps || families.has(alsFontconfigNaam(ps))) continue
      const familie = snit[16] ?? snit[1]
      const stijl = String((snit[16] ? snit[17] : snit[2]) ?? 'Regular').toLowerCase().replace(/[\s-]+/g, ' ').trim()
      const vorm = { regular: [false, false], normal: [false, false], roman: [false, false], bold: [true, false], italic: [false, true], oblique: [false, true], 'bold italic': [true, true], 'bold oblique': [true, true] }[stijl]
      if (!familie || !vorm) continue
      aliassen[alsFontconfigNaam(ps)] ??= { familie, vet: vorm[0], cursief: vorm[1] }
    }
  }
  return aliassen
}

export { alsFontconfigNaam }
