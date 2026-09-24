// Orkestratie van één offerte-conversie — de port van `UploadController.java`
// uit `esign_motrac`, zonder Spring: bestand controleren → DOCX voorbewerken
// (incl. in Word onzichtbare, bedekte vormen weghalen) → renderen naar PDF → ankers plaatsen → lettertypen vergelijken → opruimen.
//
// Elke conversie krijgt een eigen tijdelijke werkmap onder os.tmpdir() die in
// `finally` verdwijnt: offertes zijn commercieel materiaal en blijven nergens
// op schijf achter (de oude webapp had daar een aparte opruimtaak voor nodig
// omdat de download een tweede request was; hier gaat de PDF in hetzelfde
// antwoord mee, dus er valt niets te bewaren).
//
// Cluster mode: de begrenzer hieronder geldt per worker (LibreOffice-processen
// zijn zwaar, ~400–600 MB piek); de totale gelijktijdigheid is dus
// CONVERSIE_MAX_GELIJKTIJDIG × workers × replica's. Dat is bewust geen
// gedeelde teller in Postgres — een te lange wachtrij geeft gewoon een 503
// en de gebruiker probeert het zo opnieuw.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DocxOngeldig, gevraagdeLettertypen, voorbewerkDocx } from './docxVoorbewerking.js'
import { RenderFout, docxNaarPdf } from './docxNaarPdf.js'
import { lettertypenInPdf, plaatsAnkers } from './pdfCheckboxAnkers.js'
import { beschikbareLettertypen, lettertypeAliassen, vergelijkLettertypen } from './lettertypen.js'
import { gekoppeldeAfbeeldingenInDocx, vulAanMetMeegestuurd, zoekAfbeeldingen } from './gekoppeldeAfbeeldingen.js'
import { probeerLettertypeAliassen } from './lettertypeProbe.js'

/** Zelfde grens als `converter.max-file-size-mb=25` in de PoC. */
export const MAX_DOCX_BYTES = 25 * 1024 * 1024

const TIMEOUT_MS = 1000 * Number(process.env.LIBREOFFICE_TIMEOUT_SECONDEN || 120)
const MAX_GELIJKTIJDIG = Math.max(1, Number(process.env.CONVERSIE_MAX_GELIJKTIJDIG) || 2)
const MAX_WACHTRIJ = 10
const X_OFFSET = Number(process.env.CHECKBOX_X_OFFSET) || 0
const Y_OFFSET = Number(process.env.CHECKBOX_Y_OFFSET) || 0

export class ConversieFout extends Error {
  /**
   * @param {string} code fout-code in de fleet-envelop ({ error: { code, message } })
   * @param {string} message melding voor de gebruiker
   * @param {{ status?: number, detail?: string }} [opties] `detail` is alleen voor de serverlog
   */
  constructor(code, message, { status = 422, detail } = {}) {
    super(message)
    this.name = 'ConversieFout'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/** RenderFout → ConversieFout met de fleet-code en HTTP-status; andere fouten ongemoeid. */
function alsConversieFout(e) {
  if (!(e instanceof RenderFout)) return e
  const status = e.soort === 'ONBESCHIKBAAR' ? 503 : e.soort === 'TIMEOUT' ? 504 : 422
  const code = e.soort === 'ONBESCHIKBAAR' ? 'CONVERSIE_ENGINE_ONBESCHIKBAAR' : e.soort === 'TIMEOUT' ? 'CONVERSIE_TIMEOUT' : 'CONVERSIE_MISLUKT'
  return new ConversieFout(code, e.message, { status, detail: e.detail })
}

// ---- Begrenzer -----------------------------------------------------------------

let bezig = 0
const wachtrij = []

async function metPlek(taak) {
  if (bezig >= MAX_GELIJKTIJDIG) {
    if (wachtrij.length >= MAX_WACHTRIJ) {
      throw new ConversieFout('CONVERSIE_DRUK', 'Er worden op dit moment veel documenten omgezet. Probeer het over een minuut opnieuw.', { status: 503 })
    }
    await new Promise((klaar) => wachtrij.push(klaar))
  }
  bezig++
  try {
    return await taak()
  } finally {
    bezig--
    wachtrij.shift()?.()
  }
}

// ---- Bestandsnamen ------------------------------------------------------------------

/** Alleen de bestandsnaam, zonder mappen en zonder regeleinden/tabs. */
export function saneerBestandsnaam(naam) {
  if (typeof naam !== 'string') return null
  const zonderPad = naam.replace(/\\/g, '/').split('/').pop() ?? ''
  const schoon = zonderPad.replace(/[\r\n\t]/g, '').trim()
  return schoon || null
}

export function pdfNaam(docxNaam) {
  return docxNaam.replace(/\.docx$/i, '') + '.pdf'
}

// ---- De conversie -------------------------------------------------------------------

/**
 * @param {{ bestandsnaam: string, docx: Uint8Array, meegestuurdeAfbeeldingen?: Record<string, Uint8Array> }} invoer
 *   `meegestuurdeAfbeeldingen`: gekoppelde afbeeldingen die de app uit de map
 *   van de gebruiker meestuurde (op kleine-letternaam); aanvulling op de beeldbank.
 * @returns {Promise<{
 *   bestandsnaam: string, aantalCheckboxen: number, pdf: Uint8Array,
 *   lettertypen: { gevraagd: string[], inPdf: string[], vervangen: string[] },
 *   engine: string, duurMs: number, symbolenVervangen: number, ankersGeschat: number,
 *   vormenVerwijderd: number, opvulAlineas: number, afbeeldingenIngesloten: number, ontbrekendeAfbeeldingen: string[],
 *   lettertypenOmgezet: Record<string, number>
 * }>}
 */
export async function converteerOfferte({ bestandsnaam, docx, meegestuurdeAfbeeldingen = {} }) {
  const naam = saneerBestandsnaam(bestandsnaam)
  if (!naam) throw new ConversieFout('VALIDATION', 'Selecteer eerst een .docx-bestand.', { status: 400 })
  if (!/\.docx$/i.test(naam)) throw new ConversieFout('VALIDATION', 'Alleen .docx-bestanden worden ondersteund.', { status: 400 })
  if (!(docx instanceof Uint8Array) || docx.length === 0) throw new ConversieFout('VALIDATION', 'Het bestand is leeg.', { status: 400 })
  if (docx.length > MAX_DOCX_BYTES) {
    throw new ConversieFout('VALIDATION', `Het bestand is groter dan ${MAX_DOCX_BYTES / (1024 * 1024)} MB.`, { status: 400 })
  }

  return metPlek(async () => {
    const start = Date.now()
    const werkmap = await mkdtemp(path.join(os.tmpdir(), 'ds-checkbox-'))
    try {
      // Eerst de fontbestanden: de voorbewerking zet namen die LibreOffice
      // daarin niet als familie vindt om (DaxPro-Bold → DaxPro + vet).
      const fonts = await beschikbareLettertypen()
      // Gekoppelde afbeeldingen (E:\… op een Motrac-pc): eerst de beeldbank op
      // de server, dan wat de app uit de map van de gebruiker meestuurde.
      const afbeeldingen = vulAanMetMeegestuurd(await zoekAfbeeldingen(gekoppeldeAfbeeldingenInDocx(docx)), meegestuurdeAfbeeldingen)
      if (afbeeldingen.meegestuurdGebruikt) console.log(`${afbeeldingen.meegestuurdGebruikt} gekoppelde afbeelding(en) uit de map van de gebruiker`)
      if (afbeeldingen.ontbrekend.length) {
        console.warn(`Gekoppelde afbeelding(en) niet in de afbeeldingenmap: ${afbeeldingen.ontbrekend.join(', ')}`)
      }
      const fontBestanden = fonts.map((f) => f.pad)

      // Lettertypenamen die LibreOffice niet als familie vindt: eerst uit de
      // fontbestanden hier, dan — voor wat daar niet uit komt, bv. bij Gotenberg
      // zonder fontbestanden op de backend — via een render-probe bij de engine
      // zelf (één keer per worker, daarna uit de cache). De probe deelt de
      // tijd van de hoofdrender: wat hij gebruikt, gaat van LIBREOFFICE_TIMEOUT
      // af, zodat één conversie nooit langer duurt dan afgesproken.
      let aliassen = lettertypeAliassen(fonts)
      let renderBudgetMs = TIMEOUT_MS
      try {
        const probeStart = Date.now()
        const probe = await probeerLettertypeAliassen({
          gevraagd: gevraagdeLettertypen(docx),
          bekendeAliassen: aliassen,
          werkmap,
          render: (docxPad) => docxNaarPdf({ docxPad, werkmap, fontBestanden, timeoutMs: Math.min(TIMEOUT_MS, 30_000) }),
        })
        renderBudgetMs = Math.max(10_000, TIMEOUT_MS - (Date.now() - probeStart))
        if (probe.onderzocht.length) console.log(`Lettertype-probe gedaan voor: ${probe.onderzocht.join(', ')}${probe.onduidelijk.length ? ` (onduidelijk: ${probe.onduidelijk.join(', ')})` : ''}`)
        aliassen = { ...aliassen, ...probe.aliassen }
      } catch (e) {
        if (e instanceof DocxOngeldig) throw new ConversieFout('VALIDATION', e.message, { status: 400 })
        throw alsConversieFout(e)
      }

      let voorbewerkt
      try {
        voorbewerkt = voorbewerkDocx(docx, { lettertypeAliassen: aliassen, afbeeldingen: afbeeldingen.gevonden })
      } catch (e) {
        if (e instanceof DocxOngeldig) throw new ConversieFout('VALIDATION', e.message, { status: 400 })
        throw e
      }
      console.log(`DOCX voorbewerkt: ${voorbewerkt.vervangingen} symbool-run(s) vervangen door ☐, ${voorbewerkt.vormenVerwijderd} bedekte vorm(en) verwijderd, ${voorbewerkt.tekstvakAlineas} tekstvak-alinea('s) op de standaardstijl gezet, ${voorbewerkt.opvulAlineas} opvulspatie-alinea('s) rechts uitgelijnd, ${voorbewerkt.afbeeldingenIngesloten} gekoppelde afbeelding(en) ingesloten`)

      const docxPad = path.join(werkmap, 'voorbewerkt.docx')
      await writeFile(docxPad, voorbewerkt.docx)

      for (const [naam, n] of Object.entries(voorbewerkt.lettertypenOmgezet)) {
        console.log(`Lettertypenaam omgezet: ${naam} (${n}×) → familie + snit, anders valt LibreOffice terug`)
      }
      let render
      try {
        render = await docxNaarPdf({ docxPad, werkmap, fontBestanden, timeoutMs: renderBudgetMs })
      } catch (e) {
        throw alsConversieFout(e)
      }

      const gestempeld = await plaatsAnkers(render.pdf, { xOffset: X_OFFSET, yOffset: Y_OFFSET })
      for (const a of gestempeld.ankers) {
        console.log(`Anker geplaatst: ${a.naam} pagina=${a.pagina} x=${a.x.toFixed(1)} y=${a.y.toFixed(1)}${a.exact ? '' : ' (positie geschat)'}`)
      }

      // Op de gerenderde PDF vóór het stempelen: het anker-lettertype
      // (Helvetica) hoort niet in de lijst "lettertypen in de PDF".
      const inPdf = await lettertypenInPdf(render.pdf)
      const lettertypen = vergelijkLettertypen(voorbewerkt.lettertypen, inPdf)
      if (lettertypen.vervangen.length) {
        console.warn(`Lettertype(n) niet in de PDF (vervangen door LibreOffice): ${lettertypen.vervangen.join(', ')}`)
      }

      const duurMs = Date.now() - start
      console.log(`Conversie klaar. bestand=${naam} checkboxes=${gestempeld.aantal} engine=${render.engine} duurMs=${duurMs}`)
      return {
        bestandsnaam: pdfNaam(naam),
        aantalCheckboxen: gestempeld.aantal,
        pdf: gestempeld.pdf,
        lettertypen,
        engine: render.engine,
        duurMs,
        symbolenVervangen: voorbewerkt.vervangingen,
        ankersGeschat: gestempeld.ankers.filter((a) => !a.exact).length,
        vormenVerwijderd: voorbewerkt.vormenVerwijderd,
        opvulAlineas: voorbewerkt.opvulAlineas,
        afbeeldingenIngesloten: voorbewerkt.afbeeldingenIngesloten,
        ontbrekendeAfbeeldingen: afbeeldingen.ontbrekend,
        lettertypenOmgezet: voorbewerkt.lettertypenOmgezet,
      }
    } finally {
      await rm(werkmap, { recursive: true, force: true })
    }
  })
}
