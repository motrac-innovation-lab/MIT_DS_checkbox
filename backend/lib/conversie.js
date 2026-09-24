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
import { DocxOngeldig, voorbewerkDocx } from './docxVoorbewerking.js'
import { RenderFout, docxNaarPdf } from './docxNaarPdf.js'
import { lettertypenInPdf, plaatsAnkers } from './pdfCheckboxAnkers.js'
import { beschikbareLettertypen, vergelijkLettertypen } from './lettertypen.js'

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
 * @param {{ bestandsnaam: string, docx: Uint8Array }} invoer
 * @returns {Promise<{
 *   bestandsnaam: string, aantalCheckboxen: number, pdf: Uint8Array,
 *   lettertypen: { gevraagd: string[], inPdf: string[], vervangen: string[] },
 *   engine: string, duurMs: number, symbolenVervangen: number, ankersGeschat: number,
 *   vormenVerwijderd: number
 * }>}
 */
export async function converteerOfferte({ bestandsnaam, docx }) {
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
      let voorbewerkt
      try {
        voorbewerkt = voorbewerkDocx(docx)
      } catch (e) {
        if (e instanceof DocxOngeldig) throw new ConversieFout('VALIDATION', e.message, { status: 400 })
        throw e
      }
      console.log(`DOCX voorbewerkt: ${voorbewerkt.vervangingen} symbool-run(s) vervangen door ☐, ${voorbewerkt.vormenVerwijderd} bedekte vorm(en) verwijderd`)

      const docxPad = path.join(werkmap, 'voorbewerkt.docx')
      await writeFile(docxPad, voorbewerkt.docx)

      const fontBestanden = (await beschikbareLettertypen()).map((f) => f.pad)
      let render
      try {
        render = await docxNaarPdf({ docxPad, werkmap, fontBestanden, timeoutMs: TIMEOUT_MS })
      } catch (e) {
        if (e instanceof RenderFout) {
          const status = e.soort === 'ONBESCHIKBAAR' ? 503 : e.soort === 'TIMEOUT' ? 504 : 422
          const code = e.soort === 'ONBESCHIKBAAR' ? 'CONVERSIE_ENGINE_ONBESCHIKBAAR' : e.soort === 'TIMEOUT' ? 'CONVERSIE_TIMEOUT' : 'CONVERSIE_MISLUKT'
          throw new ConversieFout(code, e.message, { status, detail: e.detail })
        }
        throw e
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
      }
    } finally {
      await rm(werkmap, { recursive: true, force: true })
    }
  })
}
