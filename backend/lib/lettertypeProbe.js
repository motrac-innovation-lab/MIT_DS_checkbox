// Lettertype-aliassen afleiden door het de render-engine zélf te vragen.
//
// lettertypeAliassen() in lettertypen.js leest uit de fontbestanden op deze
// server welke gevraagde namen LibreOffice niet als familie vindt (DaxPro-Bold
// is alleen een PostScript-naam; de familie heet DaxPro, snit Bold). Bij
// DOCX_PDF_ENGINE=gotenberg staan die bestanden echter in de Gotenberg-image,
// niet hier: `/api/_health` op productie meldde op 2026-09-24 één fontbestand
// (DejaVuSans) en `viaFontmappen: false`. De alias-afleiding vond dus niets en
// "Datum:", "Offerte:", "Telefoonnummer:" bleven NotoSans, ook na PR #10.
//
// Daarom deze aanvulling, engine-onafhankelijk (ook bij soffice nuttig: een
// lettertype dat systeembreed staat maar niet in FONTS_DIR, kent LibreOffice
// wél en de bestandsafleiding niet): een mini-.docx met genummerde regels
// ("Probe1", "Probe2", …), door dezelfde engine als de echte conversie
// gerenderd. Per kandidaat-naam drie regels:
//   1. de naam zelf, gewoon           — "DaxPro-Bold"  → NotoSans      : niet gevonden
//   2. de basis mét de snit           — "DaxPro" + vet → DaxPro-Bold   : familie gevonden
//   3. (per snit één) een controleregel in een lettertype dat zeker niet
//      bestaat, met dezelfde snit     — "Xq7…" + vet   → NotoSans-Bold : dít is de terugval
// Alias alleen als regel 1 terugvalt, regel 2 in een lettertype van de basis-
// familie staat én verschilt van de terugval op regel 3. Zonder die controle
// zou "Noto-Bold" (basis "Noto", terugval NotoSans-Bold) een valse alias geven.
// Het lettertype per regel komt uit pdfjs (tekst-item → fontName →
// commonObjs, na getOperatorList()); níet per pagina uit /Resources lezen,
// want LibreOffice zet alle lettertypen van het document op elke pagina.
//
// Alleen namen met een snit-achtervoegsel dat DOCX kan uitdrukken (Bold,
// Italic, Bold Italic, Oblique) achter een koppelteken of spatie zijn
// kandidaat; "DaxPro-Light" is een eigen familie en "Semibold" kan DOCX niet
// vragen. De uitkomst wordt per proces gecachet — alleen een DUIDELIJKE
// uitkomst (alias, of aantoonbaar geen alias); een probe waarvan een regel
// niet terug te vinden is wordt de volgende keer opnieuw gedaan. Cluster mode:
// een cache, geen gedeelde staat — elke worker leert het één keer (~1-2 s).
// Een engine die niet bereikbaar is of hangt, wordt doorgegeven (de hoofdrender
// zou dezelfde fout krijgen en de gebruiker wacht anders dubbel); elke andere
// fout in de probe wordt gelogd en genegeerd.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { RenderFout } from './docxNaarPdf.js'
import { alsFontconfigNaam, normaliseerLettertype } from './lettertypen.js'
import { openMetPdfjs } from './pdfCheckboxAnkers.js'

/**
 * Snit-achtervoegsel achter een koppelteken of spatie: "DaxPro-Bold",
 * "Foo Bold Italic", "Foo-Bold-Italic", "Bar-Oblique". Niet: "Semibold",
 * "Kobold", "DaxProBold" (geen scheidingsteken — dat schrijft Word niet).
 */
const SNIT = /^(.+?)[\s-](bold[\s-]?italic|bold[\s-]?oblique|bold|italic|oblique)$/i

/** Een familienaam die geen enkele installatie heeft: levert de terugval van de engine. */
export const CONTROLE_LETTERTYPE = 'Xq7ZzNietBestaandLettertype'

function snitVanAchtervoegsel(achtervoegsel) {
  const a = achtervoegsel.toLowerCase().replace(/[\s-]+/g, '')
  return { vet: a.startsWith('bold'), cursief: a.endsWith('italic') || a.endsWith('oblique') }
}

/**
 * Welke gevraagde namen de moeite van een probe waard zijn: een snit-achtervoegsel,
 * nog niet bekend als alias, en niet al eerder met een duidelijke uitkomst onderzocht.
 * @param {string[]} gevraagd lettertypen zoals het document ze vraagt
 * @param {Record<string, unknown>} bekendeAliassen op fontconfig-naam
 * @param {Map<string, unknown>} [cache] eerder onderzochte namen (fontconfig-naam → alias|null)
 * @returns {{ naam: string, basis: string, vet: boolean, cursief: boolean }[]}
 */
export function kandidatenVoorProbe(gevraagd, bekendeAliassen = {}, cache = new Map()) {
  const uit = []
  const gezien = new Set()
  for (const naam of gevraagd) {
    const sleutel = alsFontconfigNaam(naam)
    if (!sleutel || gezien.has(sleutel) || bekendeAliassen[sleutel] || cache.has(sleutel)) continue
    const m = String(naam).trim().match(SNIT)
    if (!m) continue
    gezien.add(sleutel)
    uit.push({ naam: String(naam).trim(), basis: m[1].trim(), ...snitVanAchtervoegsel(m[2]) })
  }
  return uit
}

const snitSleutel = (k) => `${k.vet ? 'b' : ''}${k.cursief ? 'i' : ''}`

/**
 * De regels van de probe, in volgorde: per kandidaat [naam zelf, basis + snit],
 * daarna per voorkomende snit één controleregel. `controle` geeft per snit-
 * sleutel ('b', 'i', 'bi') de regelindex van die controleregel.
 */
export function probeRuns(kandidaten) {
  const runs = kandidaten.flatMap((k) => [{ font: k.naam }, { font: k.basis, vet: k.vet, cursief: k.cursief }])
  const controle = {}
  for (const k of kandidaten) {
    const s = snitSleutel(k)
    if (controle[s] === undefined) {
      controle[s] = runs.length
      runs.push({ font: CONTROLE_LETTERTYPE, vet: k.vet, cursief: k.cursief })
    }
  }
  return { runs, controle }
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const MARKERING = /^Probe(\d+)/

/**
 * De probe-.docx: één pagina, per run één alinea met alleen "Probe<n>" in het
 * gevraagde lettertype en de gevraagde snit. Één woord zonder spaties, zodat
 * de PDF-tekstlaag het als één item teruggeeft.
 * @param {{ font: string, vet?: boolean, cursief?: boolean }[]} runs
 */
export function bouwProbeDocx(runs) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const alineas = runs.map((r, i) =>
    `<w:p><w:r><w:rPr><w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:cs="${esc(r.font)}"/>${r.vet ? '<w:b/>' : ''}${r.cursief ? '<w:i/>' : ''}<w:sz w:val="24"/></w:rPr><w:t>Probe${i + 1}</w:t></w:r></w:p>`).join('')
  const onderdelen = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${alineas}`
      + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
      + '</w:body></w:document>',
  }
  return zipSync(Object.fromEntries(Object.entries(onderdelen).map(([k, v]) => [k, strToU8(v)])))
}

/**
 * Per probe-regel (index 0-gebaseerd) het lettertype waarin de PDF hem zet —
 * de BaseFont zonder subset-voorvoegsel. Regels die niet terug te vinden zijn
 * blijven undefined.
 * @returns {Promise<(string | undefined)[]>}
 */
export async function lettertypenPerProbeRegel(pdfBytes) {
  const doc = await openMetPdfjs(pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes))
  const uit = []
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const pagina = await doc.getPage(p)
      // De lettertypen komen pas in commonObjs na het inlezen van de operator-lijst.
      await pagina.getOperatorList()
      const { items } = await pagina.getTextContent()
      for (const item of items) {
        const m = MARKERING.exec(item.str ?? '')
        if (!m) continue
        let naam
        try { naam = pagina.commonObjs.get(item.fontName)?.name } catch { naam = undefined }
        if (naam) uit[Number(m[1]) - 1] = String(naam).replace(/^[A-Z]{6}\+/, '')
      }
      pagina.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return uit
}

/** Is de gevraagde naam (genormaliseerd) de familie van dit PDF-lettertype? */
function inFamilie(naam, pdfFont) {
  if (!pdfFont) return false
  const n = normaliseerLettertype(naam)
  const p = normaliseerLettertype(pdfFont)
  return n.length > 0 && (p === n || p.startsWith(n))
}

/** De PDF-fontnaam zonder snit-achtervoegsel: "DejaVuSans-BoldOblique" → "DejaVuSans". */
const zonderSnit = (pdfFont) => String(pdfFont).replace(/[-\s]?(bold\s?italic|bold\s?oblique|bolditalic|boldoblique|bold|italic|oblique|regular)$/i, '')

/**
 * Leest de uitkomst per kandidaat:
 *   - alias-object: naam zelf viel terug, en de basis + snit staat in de
 *     basisfamilie. Verschilt dat lettertype van de terugval op de
 *     controleregel, dan is de familie zeker gevonden. Is het gelijk aan de
 *     terugval, dan is de basis óf de standaardfamilie van de engine zelf
 *     (DejaVu Sans op een kale server: alias terecht) óf een niet-bestaande
 *     naam die toevallig het begin van de terugval is ("Noto" → NotoSans:
 *     alias onterecht) — dan telt alleen een exacte naam, zonder snit;
 *   - null: duidelijk geen alias nodig of mogelijk (naam zelf gevonden, of de
 *     basis valt ook terug);
 *   - undefined: onduidelijk (een regel ontbreekt in de PDF) — niet cachen.
 * @param {{ runs: object[], controle: Record<string, number> }} probe probeRuns()
 * @param {(string | undefined)[]} perRegel lettertypenPerProbeRegel()
 * @returns {Record<string, { familie: string, vet: boolean, cursief: boolean } | null | undefined>} per fontconfig-naam
 */
export function aliassenUitProbe(kandidaten, probe, perRegel) {
  const uit = {}
  kandidaten.forEach((k, i) => {
    const sleutel = alsFontconfigNaam(k.naam)
    const eigen = perRegel[2 * i]
    const basis = perRegel[2 * i + 1]
    const terugval = perRegel[probe.controle[snitSleutel(k)]]
    if (!eigen || !basis || !terugval) { uit[sleutel] = undefined; return }
    if (inFamilie(k.naam, eigen)) { uit[sleutel] = null; return } // LibreOffice kent de naam gewoon
    let basisGevonden = false
    if (inFamilie(k.basis, basis)) {
      basisGevonden = normaliseerLettertype(basis) !== normaliseerLettertype(terugval)
        || normaliseerLettertype(k.basis) === normaliseerLettertype(zonderSnit(basis))
    }
    uit[sleutel] = basisGevonden ? { familie: k.basis, vet: k.vet, cursief: k.cursief } : null
  })
  return uit
}

/** Per proces: fontconfig-naam → alias of null (onderzocht, duidelijk geen alias). */
const cache = new Map()

/** Alleen voor tests. */
export function wisProbeCache() { cache.clear() }

/**
 * Levert de aliassen die de render-engine nodig heeft en die niet uit de
 * fontbestanden af te leiden waren. Rendert hoogstens één probe per aanroep.
 * Een engine die niet bereikbaar is of hangt (RenderFout ONBESCHIKBAAR/TIMEOUT)
 * wordt doorgegeven; andere fouten worden gelogd en genegeerd.
 * @param {{
 *   gevraagd: string[],
 *   bekendeAliassen: Record<string, unknown>,
 *   render: (docxPad: string) => Promise<{ pdf: Uint8Array }>,
 *   werkmap: string,
 * }} opties `render` = docxNaarPdf met de werkmap/fonts/timeout van de conversie
 * @returns {Promise<{ aliassen: Record<string, { familie: string, vet: boolean, cursief: boolean }>, onderzocht: string[], onduidelijk: string[] }>}
 */
export async function probeerLettertypeAliassen({ gevraagd, bekendeAliassen, render, werkmap }) {
  const kandidaten = kandidatenVoorProbe(gevraagd, bekendeAliassen, cache)
  const onduidelijk = []
  if (kandidaten.length) {
    try {
      const probe = probeRuns(kandidaten)
      const pad = path.join(werkmap, 'lettertype-probe.docx')
      await writeFile(pad, bouwProbeDocx(probe.runs))
      const { pdf } = await render(pad)
      const uitkomst = aliassenUitProbe(kandidaten, probe, await lettertypenPerProbeRegel(pdf))
      for (const [sleutel, alias] of Object.entries(uitkomst)) {
        if (alias === undefined) onduidelijk.push(sleutel)
        else cache.set(sleutel, alias)
      }
    } catch (e) {
      if (e instanceof RenderFout && (e.soort === 'ONBESCHIKBAAR' || e.soort === 'TIMEOUT')) throw e
      // Geen alias is geen ramp: de conversie loopt door zoals vóór deze stap.
      console.warn('Lettertype-probe mislukt; aliassen niet afgeleid:', e?.message ?? e)
    }
  }
  const aliassen = {}
  for (const naam of gevraagd) {
    const alias = cache.get(alsFontconfigNaam(naam))
    if (alias) aliassen[alsFontconfigNaam(naam)] = alias
  }
  return { aliassen, onderzocht: kandidaten.map((k) => k.naam), onduidelijk }
}
