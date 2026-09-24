// Beheer van de beeldbank: de map op de server waarin gekoppelde afbeeldingen
// (`E:\…\AFBEELDINGEN CPQ\<naam>.png` in de .docx) op bestandsnaam gezocht
// worden — zie gekoppeldeAfbeeldingen.js. Aanleiding (Mark, 2026-09-24): "ik
// zet een keer de hele batch klaar, en bij nieuwe producten moet dit per item
// geupload kunnen worden." Beide lopen via dezelfde route; de app knipt een
// batch in stukken.
//
// Regels:
//   - Opslaan gebeurt altijd in de EERSTE map van afbeeldingMappen() (de
//     schrijfmap). Staat er al een bestand met dezelfde naam
//     (hoofdletterongevoelig, want zo zoekt de conversie), dan wordt DAT
//     bestand vervangen, op zijn plek — anders zou de conversie de oude kopie
//     blijven vinden.
//   - Alleen een bestandsnaam (isVeiligeBeeldnaam), en de inhoud moet bij de
//     extensie passen (magic bytes): een hernoemd .exe of HTML-bestand komt er
//     niet in.
//   - Schrijven via een tijdelijk bestand + rename in dezelfde map, zodat een
//     gelijktijdige conversie (andere cluster-worker) nooit een half bestand leest.
//   - De schrijfmap wordt alleen aangemaakt als de map erboven al bestaat
//     (/uploads = de persistente opslag van het platform). Bestaat die niet,
//     dan is er geen persistente opslag en zou een upload bij de volgende
//     deploy weg zijn — dan liever een duidelijke fout.
import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { afbeeldingMappen, isVeiligeBeeldnaam } from './gekoppeldeAfbeeldingen.js'

/** Maximale grootte van één afbeelding (bytes). De truckfoto's zijn een paar MB. */
export const MAX_BEELD_BYTES = 20 * 1024 * 1024

const MAX_DIEPTE = 4
const MAX_BESTANDEN = 50_000

export class BeeldbankFout extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** De map waarin geüploade afbeeldingen komen. */
export function schrijfMap(mappen = afbeeldingMappen()) {
  return mappen[0]
}

async function bestaatMap(map) {
  try {
    return (await stat(map)).isDirectory()
  } catch {
    return false
  }
}

/** Stand van de opslag, voor de kop van de beheerpagina. */
export async function beeldbankOpslag(mappen = afbeeldingMappen()) {
  const map = schrijfMap(mappen)
  const bestaat = await bestaatMap(map)
  return { map, bestaat, kanAanmaken: bestaat || (await bestaatMap(path.dirname(map))) }
}

/**
 * Alle beeldbestanden, zoals de conversie ze vindt: per kleine-letternaam de
 * eerste treffer (mappen in volgorde, alfabetisch binnen een map, submappen
 * tot 4 diep).
 * @returns {Promise<Map<string, { naam: string, pad: string, map: string }>>}
 */
async function indexMetMap(mappen) {
  const idx = new Map()
  async function loop(wortel, map, diepte) {
    if (diepte > MAX_DIEPTE || idx.size >= MAX_BESTANDEN) return
    let items
    try {
      items = await readdir(map, { withFileTypes: true })
    } catch {
      return
    }
    items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const item of items) {
      const pad = path.join(map, item.name)
      if (item.isDirectory()) await loop(wortel, pad, diepte + 1)
      else if (item.isFile() && isVeiligeBeeldnaam(item.name) && !idx.has(item.name.toLowerCase())) {
        idx.set(item.name.toLowerCase(), { naam: item.name, pad, map: wortel })
      }
    }
  }
  for (const map of mappen) await loop(map, map, 0)
  return idx
}

/**
 * Een pagina van de beeldbank, op naam gesorteerd, optioneel gefilterd op een
 * deel van de naam. Alleen de bestanden op de pagina worden ge-stat.
 */
export async function lijstBeeldbank({ zoek = '', page = 1, pageSize = 50 } = {}, mappen = afbeeldingMappen()) {
  const idx = await indexMetMap(mappen)
  const filter = zoek.trim().toLowerCase()
  const alle = [...idx.values()]
    .filter((b) => !filter || b.naam.toLowerCase().includes(filter))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' }))
  const schrijf = schrijfMap(mappen)
  const items = []
  for (const b of alle.slice((page - 1) * pageSize, page * pageSize)) {
    let info = null
    try {
      info = await stat(b.pad)
    } catch {
      // net verwijderd door een andere worker: dan zonder grootte
    }
    const submap = path.relative(b.map, path.dirname(b.pad))
    items.push({
      naam: b.naam,
      grootte: info?.size ?? null,
      gewijzigdOp: info?.mtime?.toISOString() ?? null,
      submap: submap || null,
      // Alleen wat in de schrijfmap staat is vanuit de app te beheren; een
      // tweede map uit AFBEELDINGEN_DIR is alleen-lezen.
      alleenLezen: b.map !== schrijf,
    })
  }
  return { items, page, pageSize, totaal: alle.length, opslag: await beeldbankOpslag(mappen) }
}

/**
 * Welke van deze bestanden staan er al, met dezelfde grootte? Zo kan de app
 * bij een batch alleen de nieuwe en gewijzigde bestanden versturen.
 * @param {{ bestandsnaam: string, grootte: number }[]} bestanden
 */
export async function vergelijkMetBeeldbank(bestanden, mappen = afbeeldingMappen()) {
  const idx = await indexMetMap(mappen)
  const nieuw = []
  const gewijzigd = []
  const gelijk = []
  for (const { bestandsnaam, grootte } of bestanden) {
    const b = idx.get(bestandsnaam.toLowerCase())
    if (!b) {
      nieuw.push(bestandsnaam)
      continue
    }
    let size = null
    try {
      size = (await stat(b.pad)).size
    } catch {
      // weg: dan als gewijzigd behandelen
    }
    ;(size === grootte ? gelijk : gewijzigd).push(bestandsnaam)
  }
  return { nieuw, gewijzigd, gelijk }
}

function begintMet(bytes, ...reeks) {
  return reeks.every((b, i) => bytes[i] === b)
}

/** Past de inhoud bij de extensie? Controleert de eerste bytes van het bestand. */
export function inhoudPastBijExtensie(naam, bytes) {
  const ext = naam.split('.').pop().toLowerCase()
  switch (ext) {
    case 'png': return begintMet(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    case 'jpg':
    case 'jpeg': return begintMet(bytes, 0xff, 0xd8, 0xff)
    case 'gif': return begintMet(bytes, 0x47, 0x49, 0x46, 0x38)
    case 'bmp': return begintMet(bytes, 0x42, 0x4d)
    case 'tif':
    case 'tiff': return begintMet(bytes, 0x49, 0x49, 0x2a, 0x00) || begintMet(bytes, 0x4d, 0x4d, 0x00, 0x2a)
    // EMF: record EMR_HEADER (type 1) met op byte 40 de signatuur " EMF".
    case 'emf': return begintMet(bytes, 0x01, 0x00, 0x00, 0x00) && bytes[40] === 0x20 && bytes[41] === 0x45 && bytes[42] === 0x4d && bytes[43] === 0x46
    // WMF: met "placeable"-kop (D7CDC69A) of kaal (type 1 of 2, kopgrootte 9).
    case 'wmf': return begintMet(bytes, 0xd7, 0xcd, 0xc6, 0x9a) || ((bytes[0] === 1 || bytes[0] === 2) && begintMet(bytes.subarray(1), 0x00, 0x09, 0x00))
    case 'svg': {
      const kop = Buffer.from(bytes.subarray(0, 4096)).toString('utf8').replace(/^\uFEFF/, '')
      return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(kop)
    }
    default: return false
  }
}

async function schrijfmapKlaar(mappen) {
  const map = schrijfMap(mappen)
  if (await bestaatMap(map)) return map
  if (!(await bestaatMap(path.dirname(map)))) {
    throw new BeeldbankFout('BEELDBANK_ONBESCHIKBAAR', `De beeldbankmap ${map} bestaat niet, en ${path.dirname(map)} ook niet — is de persistente opslag aangezet?`, 503)
  }
  await mkdir(map, { recursive: false }).catch((e) => {
    if (e?.code !== 'EEXIST') throw e
  })
  return map
}

/**
 * Slaat afbeeldingen op. Elk bestand staat op zichzelf: een geweigerd bestand
 * houdt de rest niet tegen.
 * @param {{ bestandsnaam: string, bytes: Uint8Array }[]} bestanden
 * @returns {Promise<{ opgeslagen: { naam: string, vervangen: boolean }[], geweigerd: { naam: string, reden: string }[] }>}
 *   reden: 'naam' | 'leeg' | 'te_groot' | 'formaat' | 'alleen_lezen' | 'schrijven'
 */
export async function slaAfbeeldingenOp(bestanden, mappen = afbeeldingMappen()) {
  const map = await schrijfmapKlaar(mappen)
  const idx = await indexMetMap(mappen)
  const opgeslagen = []
  const geweigerd = []
  for (const { bestandsnaam: naam, bytes } of bestanden) {
    if (!isVeiligeBeeldnaam(naam)) { geweigerd.push({ naam: String(naam ?? ''), reden: 'naam' }); continue }
    if (!bytes?.length) { geweigerd.push({ naam, reden: 'leeg' }); continue }
    if (bytes.length > MAX_BEELD_BYTES) { geweigerd.push({ naam, reden: 'te_groot' }); continue }
    if (!inhoudPastBijExtensie(naam, bytes)) { geweigerd.push({ naam, reden: 'formaat' }); continue }

    const bestaand = idx.get(naam.toLowerCase())
    // Een naam die de conversie in een andere (alleen-lezen) map vindt, zou
    // hier opgeslagen nooit gebruikt worden — de eerste treffer wint.
    if (bestaand && bestaand.map !== map) { geweigerd.push({ naam, reden: 'alleen_lezen' }); continue }
    const doelMap = bestaand ? path.dirname(bestaand.pad) : map
    const doel = path.join(doelMap, naam)
    const tijdelijk = path.join(doelMap, `.upload-${randomBytes(6).toString('hex')}.tmp`)
    try {
      await writeFile(tijdelijk, bytes)
      await rename(tijdelijk, doel)
      // Andere hoofdletters dan het bestaande bestand: het oude weg, anders
      // staan er twee en is het toeval welke de conversie vindt.
      if (bestaand && bestaand.pad !== doel) await unlink(bestaand.pad).catch(() => {})
      idx.set(naam.toLowerCase(), { naam, pad: doel, map })
      opgeslagen.push({ naam, vervangen: Boolean(bestaand) })
    } catch (e) {
      console.error(`Afbeelding ${naam} opslaan mislukt:`, e?.message ?? e)
      await unlink(tijdelijk).catch(() => {})
      geweigerd.push({ naam, reden: 'schrijven' })
    }
  }
  return { opgeslagen, geweigerd }
}

/** Verwijdert één afbeelding (op naam, hoofdletterongevoelig) uit de schrijfmap. */
export async function verwijderAfbeelding(naam, mappen = afbeeldingMappen()) {
  if (!isVeiligeBeeldnaam(naam)) throw new BeeldbankFout('VALIDATION', 'Geen geldige bestandsnaam van een afbeelding.', 400)
  const bestaand = (await indexMetMap(mappen)).get(naam.toLowerCase())
  if (!bestaand) throw new BeeldbankFout('NOT_FOUND', `${naam} staat niet in de beeldbank.`, 404)
  if (bestaand.map !== schrijfMap(mappen)) throw new BeeldbankFout('FORBIDDEN', `${bestaand.naam} staat in een alleen-lezen map.`, 403)
  await unlink(bestaand.pad)
  return bestaand.naam
}
