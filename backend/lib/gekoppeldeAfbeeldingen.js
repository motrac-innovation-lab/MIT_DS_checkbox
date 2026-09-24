// Afbeeldingen die de DOCX alleen KOPPELT (niet insluit) vóór de render
// alsnog insluiten, uit een afbeeldingenmap op de server.
//
// Aanleiding (2026-09-24, "test_nieuwe_opmaak_26"): de truckfoto op de pagina
// "Elektrische vorkheftruck" staat in de .docx als
//   <a:blip r:link="rId17"/>  →  Target="file:///E:\Motrac Intern Transport BV\
//     …\Standaardbestanden BID\Foto's\AFBEELDINGEN CPQ\1254_00_E50-600_BASIC_WEB_0002.png"
// Op een Motrac-pc vindt Word die netwerkschijf; de server niet, dus in de PDF
// stond een lege vlek. De configurator kan de afbeelding niet zelf insluiten
// (Mark, 2026-09-24), en op de CDN van de datasheets staat hij niet.
//
// Daarom: de beeldbank ("AFBEELDINGEN CPQ") staat als kopie in een map op de
// server, en elke gekoppelde afbeelding wordt daarin op BESTANDSNAAM gezocht
// (hoofdletterongevoelig, ook in submappen). Het pad uit het document wordt
// nooit gebruikt om een bestand te openen — alleen de naam, als sleutel in de
// index van die map. Wat er niet in staat, komt als `ontbrekendeAfbeeldingen`
// in het antwoord, zodat de gebruiker het ziet in plaats van een stille lege plek.
//
// Mappen (bestaande worden gebruikt, de rest stil overgeslagen), zoals bij de
// lettertypen:
//   - AFBEELDINGEN_DIR (komma-gescheiden) als die env-var gezet is, anders
//   - /uploads/afbeeldingen (persistente opslag van het platform). Bewust geen
//     map in het repo: de beeldbank groeit met elk nieuw truckmodel en hoort
//     niet in git (en `scripts/build.mjs` zou hem ook niet meenemen).
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { unzipSync } from 'fflate'

/** Beeldformaten die LibreOffice en Word allebei insluiten, met hun MIME-type. */
export const BEELD_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
  svg: 'image/svg+xml',
}

const MAX_DIEPTE = 4
const MAX_BESTANDEN = 50_000

export function afbeeldingMappen() {
  const env = process.env.AFBEELDINGEN_DIR?.trim()
  return env
    ? env.split(',').map((m) => path.resolve(m.trim())).filter(Boolean)
    : ['/uploads/afbeeldingen']
}

/**
 * De bestandsnaam uit een gekoppeld doel, of null als het geen beeldbestand is.
 * "file:///E:\a\b%20c\foto.PNG" → "foto.PNG"; ook UNC (\\server\…) en gewone paden.
 */
export function bestandsnaamUitDoel(doel) {
  let tekst = String(doel ?? '')
  try {
    tekst = decodeURIComponent(tekst)
  } catch {
    // ongeldige %-reeks: dan de ruwe tekst
  }
  const naam = tekst.replace(/\\/g, '/').split('/').pop()?.split(/[?#]/)[0]?.trim() ?? ''
  const ext = naam.split('.').pop()?.toLowerCase()
  return naam && ext && BEELD_MIME[ext] ? naam : null
}

/** Gekoppelde (externe, niet-web) beeldrelaties uit één .rels-bestand. */
export function gekoppeldeBeeldrelaties(relsXml) {
  const relaties = []
  for (const m of (relsXml ?? '').matchAll(/<Relationship\b[^>]*?\/?>/g)) {
    const tag = m[0]
    if (!/\bTargetMode="External"/.test(tag) || !/\bType="[^"]*\/relationships\/image"/.test(tag)) continue
    const id = tag.match(/\bId="([^"]+)"/)?.[1]
    const doel = tag.match(/\bTarget="([^"]*)"/)?.[1] ?? ''
    // http(s): een webadres is geen netwerkschijf; daar gaat deze stap niet over.
    if (!id || /^https?:/i.test(doel)) continue
    const naam = bestandsnaamUitDoel(doel.replace(/&amp;/g, '&'))
    if (naam) relaties.push({ id, doel, naam, tag })
  }
  return relaties
}

/** Welke afbeeldingen de DOCX koppelt — alleen de .rels worden uitgepakt. */
export function gekoppeldeAfbeeldingenInDocx(docxBytes) {
  let rels
  try {
    rels = unzipSync(docxBytes, { filter: (f) => /^word\/_rels\/[^/]+\.rels$/.test(f.name) })
  } catch {
    return [] // ongeldige zip: de voorbewerking meldt dat straks netjes
  }
  const namen = new Set()
  for (const bytes of Object.values(rels)) {
    for (const r of gekoppeldeBeeldrelaties(Buffer.from(bytes).toString('utf8'))) namen.add(r.naam)
  }
  return [...namen]
}

async function indexeer(map, index, diepte = 0) {
  if (diepte > MAX_DIEPTE || index.size >= MAX_BESTANDEN) return
  let items
  try {
    items = await readdir(map, { withFileTypes: true })
  } catch {
    return
  }
  for (const item of items) {
    const pad = path.join(map, item.name)
    if (item.isDirectory()) await indexeer(pad, index, diepte + 1)
    else if (item.isFile() && bestandsnaamUitDoel(item.name)) {
      // Eerste treffer wint (mappen in opgegeven volgorde, alfabetisch binnen een map).
      if (!index.has(item.name.toLowerCase())) index.set(item.name.toLowerCase(), pad)
    }
  }
}

/**
 * Zoekt de gevraagde bestandsnamen in de afbeeldingenmappen.
 * @param {string[]} namen
 * @returns {Promise<{ gevonden: Record<string, Uint8Array>, ontbrekend: string[] }>}
 *   `gevonden` op kleine-letternaam
 */
export async function zoekAfbeeldingen(namen, mappen = afbeeldingMappen()) {
  const gevonden = {}
  if (!namen.length) return { gevonden, ontbrekend: [] }
  const index = new Map()
  for (const map of mappen) await indexeer(map, index)
  const ontbrekend = []
  for (const naam of namen) {
    const pad = index.get(naam.toLowerCase())
    if (!pad) {
      ontbrekend.push(naam)
      continue
    }
    try {
      gevonden[naam.toLowerCase()] = new Uint8Array(await readFile(pad))
    } catch (e) {
      console.warn(`Afbeelding ${pad} is niet leesbaar:`, e?.message ?? e)
      ontbrekend.push(naam)
    }
  }
  return { gevonden, ontbrekend }
}

/**
 * Sluit de gevonden afbeeldingen in: nieuw zip-onderdeel `word/media/…`, de
 * relatie wordt intern, en `r:link` wordt `r:embed` op de `<a:blip>`'s die
 * die relatie gebruiken. Werkt op de al uitgepakte onderdelen, in-place.
 * @param {Record<string, Uint8Array>} onderdelen uitvoer-onderdelen van voorbewerkDocx
 * @param {Record<string, Uint8Array>} afbeeldingen zoekAfbeeldingen().gevonden
 * @param {{ lees: (b: Uint8Array) => string, schrijf: (s: string) => Uint8Array }} tekst
 * @returns {number} aantal ingesloten relaties
 */
export function sluitGekoppeldeAfbeeldingenIn(onderdelen, afbeeldingen, { lees, schrijf }) {
  if (!Object.keys(afbeeldingen).length) return 0
  let teller = 0
  let ingesloten = 0
  const extensies = new Set()
  const bestaandeMedia = new Set(Object.keys(onderdelen))

  for (const relsNaam of Object.keys(onderdelen)) {
    const m = relsNaam.match(/^word\/_rels\/([^/]+)\.rels$/)
    if (!m) continue
    const deelNaam = `word/${m[1]}`
    if (!onderdelen[deelNaam]) continue
    let rels = lees(onderdelen[relsNaam])
    let deel = lees(onderdelen[deelNaam])
    let aangepast = false
    for (const r of gekoppeldeBeeldrelaties(rels)) {
      const bytes = afbeeldingen[r.naam.toLowerCase()]
      if (!bytes) continue
      const ext = r.naam.split('.').pop().toLowerCase()
      let media = `media/gekoppeld-${++teller}.${ext}`
      while (bestaandeMedia.has(`word/${media}`)) media = `media/gekoppeld-${++teller}.${ext}`
      bestaandeMedia.add(`word/${media}`)
      onderdelen[`word/${media}`] = bytes
      extensies.add(ext)
      const nieuweTag = r.tag
        .replace(/\s+TargetMode="External"/, '')
        .replace(/\bTarget="[^"]*"/, `Target="${media}"`)
      rels = rels.replace(r.tag, nieuweTag)
      // Alleen blips zonder eigen r:embed: bij "koppelen en opslaan" staat de
      // afbeelding al in het document.
      const id = r.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      deel = deel.replace(new RegExp(`<a:blip\\b(?![^>]*\\br:embed=)([^>]*?)\\br:link="${id}"`, 'g'), '<a:blip$1r:embed="' + r.id + '"')
      aangepast = true
      ingesloten++
    }
    if (aangepast) {
      onderdelen[relsNaam] = schrijf(rels)
      onderdelen[deelNaam] = schrijf(deel)
    }
  }

  if (extensies.size && onderdelen['[Content_Types].xml']) {
    let ct = lees(onderdelen['[Content_Types].xml'])
    for (const ext of extensies) {
      if (new RegExp(`<Default\\b[^>]*\\bExtension="${ext}"`, 'i').test(ct)) continue
      ct = ct.replace(/<Types\b[^>]*>/, (t) => `${t}<Default Extension="${ext}" ContentType="${BEELD_MIME[ext]}"/>`)
    }
    onderdelen['[Content_Types].xml'] = schrijf(ct)
  }
  return ingesloten
}
