// Port van PdfCheckboxServiceTest.java uit esign_motrac. De test-PDF wordt
// met pdf-lib gebouwd (DejaVu Sans uit backend/fonts/ heeft ☐), zodat deze
// test ook zonder LibreOffice draait; de LibreOffice-keten zelf staat in
// conversie.test.js.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFName } from 'pdf-lib'
import { ankerNaam, isCheckboxMarkering, lettertypenInPdf, plaatsAnkers, tekstUitPdf, zoekCheckboxPosities } from '../lib/pdfCheckboxAnkers.js'

const fontPad = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts', 'DejaVuSans.ttf')

/** Eén pagina met de gegeven regels (van boven naar beneden) in DejaVu Sans 12pt. */
async function maakPdf(regels, { extraRegel } = {}) {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(await readFile(fontPad), { subset: true })
  const pagina = pdf.addPage([595, 842])
  let y = 740
  for (const regel of regels) {
    pagina.drawText(regel, { x: 72, y, size: 12, font })
    y -= 18
  }
  if (extraRegel) pagina.drawText(extraRegel, { x: 72, y: 600, size: 12, font })
  return new Uint8Array(await pdf.save())
}

test('herkent ☐ en U+F0A3 als checkbox, niets anders', () => {
  assert.ok(isCheckboxMarkering('☐'), 'U+2610')
  assert.ok(isCheckboxMarkering(''), 'Wingdings 2 F0A3 in de PUA')
  for (const t of ['√', '✓', '✔', '[', ']', '□', 'X', '', null, undefined]) {
    assert.ok(!isCheckboxMarkering(t), `${String(t)} mag geen checkbox zijn`)
  }
})

test('ankernamen zijn \\cb_NNN\\ met drie cijfers', () => {
  assert.equal(ankerNaam(1), '\\cb_001\\')
  assert.equal(ankerNaam(42), '\\cb_042\\')
  assert.equal(ankerNaam(1000), '\\cb_1000\\')
})

test('plaatst per ☐ een verborgen anker, laat de ☐ en bestaande ankers staan en maakt geen AcroForm', async () => {
  const bewaard = ['\\i1\\', '\\s2\\', '\\n2\\', '\\ref2\\']
  const invoer = await maakPdf(['☐ Onderhoudscontract', '☐ Keuring', '☐ Lader inbegrepen'], { extraRegel: bewaard.join(' ') })

  const { pdf, aantal, ankers } = await plaatsAnkers(invoer)
  assert.equal(aantal, 3)
  assert.deepEqual(ankers.map((a) => a.naam), ['\\cb_001\\', '\\cb_002\\', '\\cb_003\\'])
  assert.ok(ankers.every((a) => a.pagina === 1))
  // Leesvolgorde: het eerste anker staat het hoogst op de pagina.
  assert.ok(ankers[0].y > ankers[1].y && ankers[1].y > ankers[2].y)
  // Het anker eindigt vlak vóór de linkerrand van het glyph (x=72).
  for (const a of ankers) assert.ok(a.x < 72 && a.x > 60, `anker-x ${a.x} hoort net links van 72 te liggen`)

  const tekst = await tekstUitPdf(pdf)
  for (const n of [1, 2, 3]) assert.ok(tekst.includes(ankerNaam(n)), `tekstlaag mist ${ankerNaam(n)}`)
  assert.ok(!tekst.includes(ankerNaam(4)), 'teller stopt bij drie')
  for (const a of bewaard) assert.ok(tekst.includes(a), `bestaand anker ${a} moet blijven`)
  assert.equal([...tekst].filter((t) => t === '☐').length, 3, 'de zichtbare ☐ blijven staan')

  const uit = await PDFDocument.load(pdf)
  assert.equal(uit.catalog.get(PDFName.of('AcroForm')), undefined, 'geen AcroForm')
})

test('zes checkboxen geven zes globale ankers en √ telt niet mee', async () => {
  const invoer = await maakPdf([
    '☐ Onderhoudscontract', '☐ Keuring', '☐ Lader inbegrepen', '☐ Transport', '☐ Garantie', '☐ Opleiding',
    'Service inclusief: √ Smering √ Filters √ Banden',
  ])
  const { pdf, aantal } = await plaatsAnkers(invoer)
  assert.equal(aantal, 6)
  const tekst = await tekstUitPdf(pdf)
  for (let n = 1; n <= 6; n++) assert.ok(tekst.includes(ankerNaam(n)))
  assert.ok(!tekst.includes(ankerNaam(7)))
})

test('een ☐ midden in een tekst-item krijgt een geschatte positie, gemarkeerd als niet-exact', async () => {
  const invoer = await maakPdf(['Kies: ☐ ja'])
  const posities = await zoekCheckboxPosities(invoer)
  assert.equal(posities.length, 1)
  assert.equal(posities[0].exact, false)
  assert.ok(posities[0].x > 72, 'ligt rechts van het begin van de regel')
})

test('zonder checkbox komt de PDF ongewijzigd terug', async () => {
  const invoer = await maakPdf(['Geen vakjes hier'])
  const r = await plaatsAnkers(invoer)
  assert.equal(r.aantal, 0)
  assert.equal(r.pdf, invoer)
})

test('lettertypen in de PDF worden zonder subset-voorvoegsel gemeld', async () => {
  const invoer = await maakPdf(['☐ test'])
  const namen = await lettertypenInPdf(invoer)
  assert.ok(namen.some((n) => /^DejaVuSans/.test(n)), `verwacht DejaVuSans in ${namen}`)
  assert.ok(namen.every((n) => !/^[A-Z]{6}\+/.test(n)), 'subset-voorvoegsel moet weg zijn')
})
