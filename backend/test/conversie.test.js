// De offerte-conversie over de echte server: upload als base64-JSON, de PDF
// terug in het antwoord, het logboek gevuld. Draait de LibreOffice-keten als
// `soffice` op deze machine staat; zo niet, dan controleert hij dat de server
// dat netjes meldt (503 CONVERSIE_ENGINE_ONBESCHIKBAAR) — geen skip, want CI
// eist "# skipped 0", en een stille skip zou de e2e-dekking onzichtbaar
// laten wegvallen. Welke tak liep staat in de testuitvoer.
import assert from 'node:assert/strict'
import test, { after, before, describe } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { startBackend, TOKEN_ADMIN, TOKEN_GEBRUIKER } from './helpers/server.js'
import { slaOverZonderDb } from './helpers/postgres.js'
import { detecteerLibreOffice } from '../lib/docxNaarPdf.js'
import { ankerNaam, tekstUitPdf } from '../lib/pdfCheckboxAnkers.js'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const SYM = '<w:sym w:font="Wingdings 2" w:char="F0A3"/>'

/** Een minimaal maar voor LibreOffice geldig .docx: body met checkboxen, een header met een ☐. */
function maakOfferteDocx() {
  const run = (tekst) => `<w:r><w:t xml:space="preserve">${tekst}</w:t></w:r>`
  const onderdelen = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
      + '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
      + '</Relationships>',
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>`
      // De terugvallen die Word overal neerzet en die nooit gerenderd worden:
      // w:eastAsia (CJK) en w:cs (complex script). Ze horen niet in `gevraagd`.
      + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>'
      + '</w:styles>',
    'word/header1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W}><w:p>${run('☐ Kopregel')}</w:p></w:hdr>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ${W}><w:body>`
      + `<w:p>${run('Offerte heftruck')}</w:p>`
      + `<w:p><w:r>${SYM}</w:r>${run(' Onderhoudscontract')}</w:p>`
      + `<w:p>${run('☐ Keuring')}</w:p>`
      + `<w:p>${run('Service inclusief: √ Smering')}</w:p>`
      // Een alinea met een eigen lettertype op de alineamarkering (Consolas) en
      // een complex-script-terugval op de run (Arial): beide zonder zichtbare
      // tekst in dat lettertype, dus geen van beide is "gevraagd".
      + '<w:p><w:pPr><w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr></w:pPr>'
      + '<w:r><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="Arial"/></w:rPr><w:t xml:space="preserve">Levertijd in overleg</w:t></w:r></w:p>'
      + `<w:p>${run('Handtekening: \\s2\\')}</w:p>`
      + '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
      + '</w:body></w:document>',
  }
  return zipSync(Object.fromEntries(Object.entries(onderdelen).map(([k, v]) => [k, strToU8(v)])))
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64')

let backend
before(async () => { if (!slaOverZonderDb) backend = await startBackend() })
after(async () => { if (backend) await backend.stop() })

describe('offerte-conversie', { skip: slaOverZonderDb }, () => {
  test('de statusroute beschrijft engine en lettertypen', async () => {
    const res = await backend.api('/api/conversies/status', { token: TOKEN_GEBRUIKER })
    assert.equal(res.status, 200)
    assert.equal(res.json.engine, 'soffice')
    assert.equal(typeof res.json.beschikbaar, 'boolean')
    assert.deepEqual(res.json.lettertypen.vereist, ['DaxPro', 'DaxPro-Light', 'DaxPro-Medium'])
    assert.ok(res.json.lettertypen.bestanden.some((b) => b.families.includes('DejaVu Sans')))
    assert.equal(res.json.lettertypen.viaFontmappen, true, 'bij soffice gaan de fontmappen van de server mee in de render')
  })

  // Bij Gotenberg gaat alleen de .docx naar de dienst; de fontmappen van deze
  // server zeggen dan niets over de PDF. De status en /api/_health moeten dat
  // melden, anders wijst de statuskaart naar backend/fonts/ terwijl de fonts
  // in de Gotenberg-image horen (gezien op de statuskaart, 2026-09-22).
  test('bij de Gotenberg-engine meldt de status dat de fontmappen niet meetellen', async () => {
    const extern = await startBackend({ extraEnv: { DOCX_PDF_ENGINE: 'gotenberg', GOTENBERG_URL: 'http://127.0.0.1:9' } })
    try {
      const status = await extern.api('/api/conversies/status', { token: TOKEN_GEBRUIKER })
      assert.equal(status.status, 200)
      assert.equal(status.json.engine, 'gotenberg')
      assert.equal(status.json.beschikbaar, false, 'poort 9 (discard) is geen Gotenberg')
      assert.equal(status.json.lettertypen.viaFontmappen, false)
      // De meting over deze server blijft wél eerlijk: DaxPro staat hier niet.
      assert.deepEqual(status.json.lettertypen.ontbreekt, ['DaxPro', 'DaxPro-Light', 'DaxPro-Medium'])

      const health = await extern.api('/api/_health')
      assert.equal(health.json.conversie.engine, 'gotenberg')
      assert.equal(health.json.conversie.viaFontmappen, false)
    } finally {
      await extern.stop()
    }
  })

  test('/api/_health meldt de conversie-engine zonder gevoelige details', async () => {
    const res = await backend.api('/api/_health')
    assert.equal(res.json.conversie.engine, 'soffice')
    assert.ok(['boolean'].includes(typeof res.json.conversie.libreofficeGevonden) || res.json.conversie.libreofficeGevonden === null)
    assert.equal(res.json.conversie.viaFontmappen, true)
  })

  test('zonder bestand een 400 VALIDATION', async () => {
    const res = await backend.api('/api/conversies', { token: TOKEN_GEBRUIKER, methode: 'POST', body: {} })
    assert.equal(res.status, 400)
    assert.equal(res.json.error.code, 'VALIDATION')
  })

  test('een ander bestandstype dan .docx een 400', async () => {
    const res = await backend.api('/api/conversies', { token: TOKEN_GEBRUIKER, methode: 'POST', body: { bestandsnaam: 'offerte.pdf', docxBase64: b64(maakOfferteDocx()) } })
    assert.equal(res.status, 400)
    assert.match(res.json.error.message, /\.docx/)
  })

  test('een .docx dat geen zip is een 400', async () => {
    const res = await backend.api('/api/conversies', { token: TOKEN_GEBRUIKER, methode: 'POST', body: { bestandsnaam: 'offerte.docx', docxBase64: b64(Buffer.from('geen zip')) } })
    assert.equal(res.status, 400)
    assert.equal(res.json.error.code, 'VALIDATION')
  })

  test('zonder token is de conversie dicht', async () => {
    const res = await backend.api('/api/conversies', { methode: 'POST', body: { bestandsnaam: 'offerte.docx', docxBase64: b64(maakOfferteDocx()) } })
    assert.equal(res.status, 401)
  })

  test('een geldige offerte wordt omgezet — of de server meldt dat LibreOffice ontbreekt', async (t) => {
    const lo = await detecteerLibreOffice()
    const res = await backend.api('/api/conversies', {
      token: TOKEN_GEBRUIKER,
      methode: 'POST',
      body: { bestandsnaam: 'Offerte 123.docx', docxBase64: b64(maakOfferteDocx()) },
    })

    if (!lo.gevonden) {
      t.diagnostic('LibreOffice niet aanwezig op deze machine — alleen de 503-tak getest, de render-keten niet')
      assert.equal(res.status, 503)
      assert.equal(res.json.error.code, 'CONVERSIE_ENGINE_ONBESCHIKBAAR')
      const log = await backend.api('/api/conversies', { token: TOKEN_ADMIN })
      assert.ok(log.json.items.some((i) => i.status === 'mislukt' && i.foutcode === 'CONVERSIE_ENGINE_ONBESCHIKBAAR'))
      return
    }

    t.diagnostic(`LibreOffice ${lo.versie} — volledige keten getest`)
    assert.equal(res.status, 200, JSON.stringify(res.json).slice(0, 300))
    assert.equal(res.json.bestandsnaam, 'Offerte 123.pdf')
    assert.equal(res.json.aantalCheckboxen, 3, 'symbool + literaal ☐ in de body + ☐ in de header')
    assert.equal(res.json.symbolenVervangen, 1)
    assert.equal(res.json.engine, 'soffice')
    assert.ok(res.json.lettertypen.gevraagd.includes('DejaVu Sans'))
    assert.ok(!res.json.lettertypen.vervangen.includes('DejaVu Sans'), 'DejaVu Sans komt uit backend/fonts/ en mag niet vervangen zijn')
    // Over de echte keten: Times New Roman (w:eastAsia/w:cs), Arial (w:cs) en
    // Consolas (alineamarkering) zetten geen zichtbare tekst, komen dus niet in
    // de PDF en mogen geen valse "Lettertype vervangen"-melding geven.
    assert.deepEqual(res.json.lettertypen.gevraagd, ['DejaVu Sans'], 'alleen het lettertype van de zichtbare tekst')
    assert.deepEqual(res.json.lettertypen.vervangen, [], 'geen valse "vervangen"-melding')

    const pdf = new Uint8Array(Buffer.from(res.json.pdfBase64, 'base64'))
    assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), '%PDF-')
    const tekst = await tekstUitPdf(pdf)
    for (const n of [1, 2, 3]) assert.ok(tekst.includes(ankerNaam(n)), `tekstlaag mist ${ankerNaam(n)}`)
    assert.ok(!tekst.includes(ankerNaam(4)))
    assert.ok(tekst.includes('\\s2\\'), 'bestaand anker blijft staan')
    assert.equal([...tekst].filter((c) => c === '☐').length, 3, 'zichtbare vakjes blijven staan')
    assert.ok(!tekst.includes('<w:sym'))
  })

  test('het conversies-logboek is beheerder-only en gepagineerd', async () => {
    const dicht = await backend.api('/api/conversies', { token: TOKEN_GEBRUIKER })
    assert.equal(dicht.status, 403)
    const open = await backend.api('/api/conversies?page=1&pageSize=5', { token: TOKEN_ADMIN })
    assert.equal(open.status, 200)
    assert.deepEqual(Object.keys(open.json).sort(), ['items', 'page', 'pageSize', 'totaal'])
    assert.ok(open.json.totaal >= 1, 'de conversie van hierboven hoort in het logboek te staan')
    const regel = open.json.items.find((i) => i.bestandsnaam === 'Offerte 123.docx')
    assert.ok(regel, 'regel voor Offerte 123.docx ontbreekt')
    assert.equal(regel.actorNaam, 'Test Gebruiker')
    assert.ok(Array.isArray(regel.lettertypenVervangen))
  })

  test('een bestand boven de 25 MB is een 400, en een body boven de padlimiet een nette 413', async () => {
    // 26 MB past nog in de JSON-bodylimiet van het pad (35 MB base64) en
    // strandt op de bestandsgrens van 25 MB in lib/conversie.js …
    const netTeGroot = Buffer.alloc(26 * 1024 * 1024).toString('base64')
    const res400 = await backend.api('/api/conversies', { token: TOKEN_GEBRUIKER, methode: 'POST', body: { bestandsnaam: 'groot.docx', docxBase64: netTeGroot } })
    assert.equal(res400.status, 400)
    assert.match(res400.json.error.message, /25 MB/)
    // … en 27 MB (36 MB base64) wordt al door body-parser geweigerd: 413 in de fleet-envelop, geen 500.
    const veelTeGroot = Buffer.alloc(27 * 1024 * 1024).toString('base64')
    const res413 = await backend.api('/api/conversies', { token: TOKEN_GEBRUIKER, methode: 'POST', body: { bestandsnaam: 'groot.docx', docxBase64: veelTeGroot } })
    assert.equal(res413.status, 413)
    assert.equal(res413.json.error.code, 'VALIDATION')
  })
})
