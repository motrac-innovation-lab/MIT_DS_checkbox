// De render-stap DOCX → PDF. Port van `DocxToPdfService.java` uit
// `esign_motrac`, met twee omwisselbare engines omdat het serverpark
// (IT Dashboard, Node 24, `node_upload`) zelf geen LibreOffice meebrengt:
//
//   DOCX_PDF_ENGINE=soffice   (standaard) LibreOffice headless op dezelfde
//                             machine, via LIBREOFFICE_COMMAND (standaard
//                             `soffice`, dan `libreoffice` op het PATH).
//   DOCX_PDF_ENGINE=gotenberg een externe LibreOffice-dienst met de
//                             Gotenberg-API (https://gotenberg.dev),
//                             bereikbaar op GOTENBERG_URL. Voor het geval
//                             LibreOffice niet op de fleet-server zelf mag/kan.
//
// Een pure-JS DOCX-renderer met Word-getrouwe layout bestaat niet; de
// render moet dus altijd door LibreOffice. Welke van de twee engines het
// wordt, is een deploy-keuze van Mark (zie DEPLOY.md) — niet iets dat de
// code kan omzeilen.
//
// Fonts: elke soffice-aanroep krijgt een eigen, tijdelijk gebruikersprofiel
// (`-env:UserInstallation`), zodat cluster-workers elkaar niet in de weg
// zitten (LibreOffice weigert een tweede instantie op hetzelfde profiel). In
// dat profiel komt `user/fonts/` met de lettertypen uit lib/lettertypen.js —
// LibreOffice leest die map bij het opstarten, ook zonder fontconfig-
// registratie. Zo blijft DaxPro in de PDF staan zonder systeeminstallatie.
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const ENGINE = (process.env.DOCX_PDF_ENGINE || 'soffice').trim().toLowerCase()
const GOTENBERG_URL = (process.env.GOTENBERG_URL || '').replace(/\/$/, '')
const GOTENBERG_AUTH_USER = process.env.GOTENBERG_BASIC_AUTH_USER || ''
const GOTENBERG_AUTH_PASS = process.env.GOTENBERG_BASIC_AUTH_PASS || ''

/**
 * Headers voor requests naar Gotenberg. Sommige Gotenberg-installaties staan
 * achter Basic Auth (bv. via een .htaccess vóór de dienst) — zonder
 * `Authorization`-header geeft zo'n installatie een 401 op precies het
 * conversie-endpoint, terwijl `/health` er soms wél doorheen komt.
 */
function gotenbergHeaders() {
  if (!GOTENBERG_AUTH_USER || !GOTENBERG_AUTH_PASS) return {}
  const token = Buffer.from(`${GOTENBERG_AUTH_USER}:${GOTENBERG_AUTH_PASS}`).toString('base64')
  return { Authorization: `Basic ${token}` }
}

export class RenderFout extends Error {
  /** @param {'ONBESCHIKBAAR'|'MISLUKT'|'TIMEOUT'} soort */
  constructor(soort, message, detail) {
    super(message)
    this.name = 'RenderFout'
    this.soort = soort
    // Technische uitvoer (stderr van soffice e.d.) — alleen voor de serverlog,
    // nooit naar de gebruiker: kan paden en interne meldingen bevatten.
    this.detail = detail
  }
}

// ---- LibreOffice-detectie ----------------------------------------------------

let detectiePromise
/**
 * Zoekt het LibreOffice-commando en leest de versie — één keer per proces,
 * gecachet. `{ gevonden:false }` is geen fout: de statusroute en /api/_health
 * tonen het, en een conversie geeft dan een duidelijke 503.
 */
export function detecteerLibreOffice() {
  return (detectiePromise ??= (async () => {
    const kandidaten = [process.env.LIBREOFFICE_COMMAND?.trim(), 'soffice', 'libreoffice'].filter(Boolean)
    for (const commando of kandidaten) {
      const profiel = await mkdtemp(path.join(os.tmpdir(), 'ds-checkbox-lo-versie-'))
      try {
        const { code, uitvoer } = await draai(commando, [profielArg(profiel), '--headless', '--version'], { timeoutMs: 30_000 })
        const versie = uitvoer.match(/LibreOffice\s+([\d.]+)/)?.[1] ?? null
        if (code === 0 && versie) return { gevonden: true, commando, versie }
      } catch {
        // niet gevonden of niet uitvoerbaar — volgende kandidaat
      } finally {
        await rm(profiel, { recursive: true, force: true })
      }
    }
    return { gevonden: false, commando: kandidaten[0] ?? 'soffice', versie: null }
  })())
}

function profielArg(map) {
  return `-env:UserInstallation=${pathToFileURL(map).href}`
}

/** Start een proces, wacht met time-out, geeft exitcode + (begrensde) uitvoer terug. */
function draai(commando, args, { timeoutMs, cwd, env }) {
  return new Promise((klaar, mislukt) => {
    let uitvoer = ''
    let proces
    try {
      proces = spawn(commando, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      mislukt(e)
      return
    }
    const timer = setTimeout(() => {
      proces.kill('SIGKILL')
      mislukt(new RenderFout('TIMEOUT', 'De omzetting naar PDF duurde te lang en is afgebroken.'))
    }, timeoutMs)
    const vang = (chunk) => { if (uitvoer.length < 20_000) uitvoer += String(chunk) }
    proces.stdout.on('data', vang)
    proces.stderr.on('data', vang)
    proces.on('error', (e) => { clearTimeout(timer); mislukt(e) })
    proces.on('close', (code) => { clearTimeout(timer); klaar({ code, uitvoer }) })
  })
}

// ---- Engine: LibreOffice lokaal ---------------------------------------------

/**
 * @param {{ docxPad: string, werkmap: string, fontBestanden: string[], timeoutMs: number }} opties
 * @returns {Promise<Uint8Array>} de PDF-bytes
 */
async function metLibreOffice({ docxPad, werkmap, fontBestanden, timeoutMs }) {
  const lo = await detecteerLibreOffice()
  if (!lo.gevonden) {
    throw new RenderFout('ONBESCHIKBAAR', 'LibreOffice is op deze server niet gevonden; de omzetting naar PDF kan niet draaien. Zie DEPLOY.md.')
  }

  const profiel = path.join(werkmap, 'profiel')
  const fontMap = path.join(profiel, 'user', 'fonts')
  await mkdir(fontMap, { recursive: true })
  await Promise.all(fontBestanden.map((bron) => copyFile(bron, path.join(fontMap, path.basename(bron)))))

  const args = [
    profielArg(profiel),
    '--headless', '--norestore', '--nologo', '--nolockcheck',
    '--convert-to', 'pdf:writer_pdf_Export',
    '--outdir', werkmap,
    docxPad,
  ]
  // HOME naar de werkmap: LibreOffice schrijft anders in de home van de
  // systeemgebruiker (op het platform: root), en de javaldx-waarschuwing
  // ("java may not function correctly") is voor een PDF-export irrelevant.
  const env = { ...process.env, HOME: werkmap, SAL_USE_VCLPLUGIN: 'svp' }
  const { code, uitvoer } = await draai(lo.commando, args, { timeoutMs, cwd: werkmap, env })

  const pdfPad = path.join(werkmap, `${path.basename(docxPad, path.extname(docxPad))}.pdf`)
  if (code !== 0 || !existsSync(pdfPad)) {
    throw new RenderFout(
      'MISLUKT',
      'Het document kon niet naar PDF worden omgezet. Controleer of het bestand in Word geopend kan worden.',
      `soffice exitcode=${code}\n${uitvoer}`,
    )
  }
  return new Uint8Array(await readFile(pdfPad))
}

// ---- Engine: Gotenberg (externe LibreOffice-dienst) -------------------------

async function metGotenberg({ docxPad, timeoutMs }) {
  if (!GOTENBERG_URL) {
    throw new RenderFout('ONBESCHIKBAAR', 'GOTENBERG_URL is niet gezet terwijl DOCX_PDF_ENGINE=gotenberg is; de omzetting naar PDF kan niet draaien.')
  }
  const formulier = new FormData()
  formulier.append('files', new Blob([await readFile(docxPad)]), path.basename(docxPad))
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, { method: 'POST', body: formulier, headers: gotenbergHeaders(), signal: ac.signal })
    if (!res.ok) {
      throw new RenderFout('MISLUKT', 'Het document kon niet naar PDF worden omgezet door de LibreOffice-dienst.', `gotenberg status=${res.status} ${(await res.text()).slice(0, 2000)}`)
    }
    return new Uint8Array(await res.arrayBuffer())
  } catch (e) {
    if (e instanceof RenderFout) throw e
    if (e?.name === 'AbortError') throw new RenderFout('TIMEOUT', 'De omzetting naar PDF duurde te lang en is afgebroken.')
    throw new RenderFout('ONBESCHIKBAAR', 'De LibreOffice-dienst (Gotenberg) is niet bereikbaar.', String(e?.message ?? e))
  } finally {
    clearTimeout(timer)
  }
}

// ---- Publieke ingang -----------------------------------------------------------

/**
 * Rendert een DOCX naar PDF met de geconfigureerde engine.
 * @returns {Promise<{ pdf: Uint8Array, engine: string }>}
 */
export async function docxNaarPdf(opties) {
  if (ENGINE === 'gotenberg') return { pdf: await metGotenberg(opties), engine: 'gotenberg' }
  if (ENGINE !== 'soffice') {
    throw new RenderFout('ONBESCHIKBAAR', `Onbekende DOCX_PDF_ENGINE "${ENGINE}" — kies soffice of gotenberg.`)
  }
  return { pdf: await metLibreOffice(opties), engine: 'soffice' }
}

/** Voor de statusroute: is de engine bruikbaar, en welke is het? */
export async function engineStatus() {
  if (ENGINE === 'gotenberg') {
    let bereikbaar = false
    if (GOTENBERG_URL) {
      try {
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), 5000)
        const res = await fetch(`${GOTENBERG_URL}/health`, { headers: gotenbergHeaders(), signal: ac.signal }).finally(() => clearTimeout(timer))
        bereikbaar = res.ok
      } catch {
        bereikbaar = false
      }
    }
    return { engine: 'gotenberg', beschikbaar: bereikbaar, libreoffice: null, gotenbergGeconfigureerd: Boolean(GOTENBERG_URL) }
  }
  const lo = await detecteerLibreOffice()
  return { engine: 'soffice', beschikbaar: lo.gevonden, libreoffice: lo, gotenbergGeconfigureerd: false }
}
