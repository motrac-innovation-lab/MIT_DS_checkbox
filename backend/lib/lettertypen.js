// Lettertypen voor de DOCX→PDF-render — de eis van Mark (2026-09-21): een
// geüploade offerte in DaxPro / DaxPro-Light / DaxPro-Medium moet in de PDF
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

/** De families die een Motrac-offerte gebruikt; de statuspagina meldt welke ontbreken. */
export const VEREISTE_LETTERTYPEN = ['DaxPro', 'DaxPro-Light', 'DaxPro-Medium']

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
 * @returns {Promise<{ bestand: string, pad: string, families: string[], postscript: string[] }[]>}
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
        const { families, postscript } = leesNamen(await readFile(pad))
        gevonden.push({ bestand: naam, pad, families, postscript })
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
  const tag = data.readUInt32BE(0)
  // TrueType Collection: elk lettertype apart nalopen.
  const offsets = tag === 0x74746366 /* 'ttcf' */
    ? Array.from({ length: data.readUInt32BE(8) }, (_, i) => data.readUInt32BE(12 + i * 4))
    : [0]
  for (const basis of offsets) leesNameTabel(data, basis, families, postscript)
  return { families: [...families], postscript: [...postscript] }
}

function leesNameTabel(data, basis, families, postscript) {
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
      if (nameId !== 1 && nameId !== 16 && nameId !== 6) continue
      const lengte = data.readUInt16BE(r + 8)
      const begin = stringsOffset + data.readUInt16BE(r + 10)
      if (begin + lengte > data.length) continue
      // Windows (3) en Unicode (0) zijn UTF-16BE; Macintosh (1) is in de praktijk ASCII.
      const tekst = platform === 1
        ? data.toString('latin1', begin, begin + lengte)
        : utf16be(data.subarray(begin, begin + lengte))
      const schoon = tekst.replace(/\0/g, '').trim()
      if (!schoon) continue
      if (nameId === 6) postscript.add(schoon)
      else families.add(schoon)
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
