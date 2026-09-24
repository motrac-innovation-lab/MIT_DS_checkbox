// De render-probe voor lettertype-aliassen (lib/lettertypeProbe.js): welke
// namen kandidaat zijn, hoe de probe-.docx eruitziet, hoe de uitkomst gelezen
// wordt (met de controleregel tegen valse aliassen) en dat een mislukte probe
// de conversie nooit tegenhoudt — behalve als de engine zelf weg is. Pure
// logica: de PDF voor de leesstap komt uit pdf-lib met standaardlettertypen,
// geen LibreOffice. De echte keten (probe → alias → render) zit in
// conversie.test.js ("snitnaam").
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { RenderFout } from '../lib/docxNaarPdf.js'
import {
  CONTROLE_LETTERTYPE,
  aliassenUitProbe,
  bouwProbeDocx,
  kandidatenVoorProbe,
  lettertypenPerProbeRegel,
  probeRuns,
  probeerLettertypeAliassen,
  wisProbeCache,
} from '../lib/lettertypeProbe.js'

test('kandidatenVoorProbe: alleen een snit-achtervoegsel achter koppelteken/spatie, ontdubbeld zoals fontconfig, zonder bekende of al onderzochte', () => {
  // "DAXPRO-BOLD" is voor fontconfig dezelfde naam als "DaxPro-Bold" (hoofdletters
  // tellen niet); "DaxPro Bold" (spatie i.p.v. koppelteken) juist NIET — dat is
  // precies waarom LibreOffice "DaxPro-Bold" niet op familie "DaxPro Bold" vindt.
  const gevraagd = ['DaxPro', 'DaxPro-Light', 'DaxPro-Bold', 'DAXPRO-BOLD', 'DaxPro Bold', 'Foo Bold Italic', 'Foo-Bold-Italic', 'Bar-Oblique',
    'DaxPro-Semibold', 'Extrabold', 'Kobold', 'DaxProBold', 'Al-Bekend-Bold', 'Eerder-Bold', 'Calibri']
  const k = kandidatenVoorProbe(gevraagd, { 'al-bekend-bold': {} }, new Map([['eerder-bold', null]]))
  assert.deepEqual(k, [
    { naam: 'DaxPro-Bold', basis: 'DaxPro', vet: true, cursief: false },
    { naam: 'DaxPro Bold', basis: 'DaxPro', vet: true, cursief: false },
    { naam: 'Foo Bold Italic', basis: 'Foo', vet: true, cursief: true },
    { naam: 'Foo-Bold-Italic', basis: 'Foo', vet: true, cursief: true },
    { naam: 'Bar-Oblique', basis: 'Bar', vet: false, cursief: true },
  ])
})

test('probeRuns: per kandidaat [naam zelf, basis + snit], daarna per snit één controleregel in een onbestaand lettertype', () => {
  const { runs, controle } = probeRuns([
    { naam: 'X-Bold', basis: 'X', vet: true, cursief: false },
    { naam: 'Y-Italic', basis: 'Y', vet: false, cursief: true },
    { naam: 'Z-Bold', basis: 'Z', vet: true, cursief: false },
  ])
  assert.deepEqual(runs, [
    { font: 'X-Bold' }, { font: 'X', vet: true, cursief: false },
    { font: 'Y-Italic' }, { font: 'Y', vet: false, cursief: true },
    { font: 'Z-Bold' }, { font: 'Z', vet: true, cursief: false },
    { font: CONTROLE_LETTERTYPE, vet: true, cursief: false },
    { font: CONTROLE_LETTERTYPE, vet: false, cursief: true },
  ])
  assert.deepEqual(controle, { b: 6, i: 7 })
})

test('bouwProbeDocx: een geldige .docx met per run één alinea "Probe<n>" in dat lettertype, XML-veilig', () => {
  const docx = bouwProbeDocx([{ font: 'A&B "C"' }, { font: 'X', vet: true, cursief: true }])
  const delen = unzipSync(docx)
  assert.ok(delen['[Content_Types].xml'] && delen['_rels/.rels'])
  const xml = strFromU8(delen['word/document.xml'])
  assert.ok(xml.includes('<w:rFonts w:ascii="A&amp;B &quot;C&quot;" w:hAnsi="A&amp;B &quot;C&quot;" w:cs="A&amp;B &quot;C&quot;"/>'))
  assert.ok(xml.includes('<w:t>Probe1</w:t>') && xml.includes('<w:t>Probe2</w:t>'))
  assert.ok(/<w:rFonts w:ascii="X"[^>]*\/><w:b\/><w:i\/>/.test(xml))
  assert.ok(!xml.includes('<w:br'), 'één pagina: LibreOffice deelt de lettertypen toch over alle pagina\'s')
})

test('lettertypenPerProbeRegel leest per regel het echte lettertype uit de PDF', async () => {
  const pdf = await PDFDocument.create()
  const pagina = pdf.addPage()
  const gewoon = await pdf.embedFont(StandardFonts.Helvetica)
  const vet = await pdf.embedFont(StandardFonts.HelveticaBold)
  pagina.drawText('Probe1', { x: 50, y: 700, size: 12, font: gewoon })
  pagina.drawText('Probe2', { x: 50, y: 680, size: 12, font: vet })
  pagina.drawText('geen probe', { x: 50, y: 660, size: 12, font: vet })
  const perRegel = await lettertypenPerProbeRegel(await pdf.save())
  assert.deepEqual(perRegel, ['Helvetica', 'Helvetica-Bold'])
})

test('aliassenUitProbe: alias alleen als de naam terugvalt, de basis in de familie staat én verschilt van de terugval', () => {
  const k = [
    { naam: 'DaxPro-Bold', basis: 'DaxPro', vet: true, cursief: false },   // terugval, basis gevonden → alias
    { naam: 'Echt-Bold', basis: 'Echt', vet: true, cursief: false },       // naam zelf gevonden → geen alias nodig
    { naam: 'Weg-Italic', basis: 'Weg', vet: false, cursief: true },       // beide terugval → niets te doen
    { naam: 'Noto-Bold', basis: 'Noto', vet: true, cursief: false },       // basis "gevonden" maar gelijk aan de terugval en niet exact → GEEN alias
    { naam: 'Leeg-Bold', basis: 'Leeg', vet: true, cursief: false },       // regel niet in de PDF → onduidelijk
    { naam: 'NotoSans-Bold', basis: 'NotoSans', vet: true, cursief: false }, // basis IS de standaardfamilie van de engine (gelijk aan de terugval, exact) → alias
  ]
  const probe = probeRuns(k)
  assert.deepEqual(probe.controle, { b: 12, i: 13 })
  const perRegel = []
  perRegel[0] = 'NotoSans-Bold'; perRegel[1] = 'DaxPro-Bold'
  perRegel[2] = 'Echt-Bold'; perRegel[3] = 'Echt-Bold'
  perRegel[4] = 'DejaVuSans'; perRegel[5] = 'DejaVuSans-Oblique'
  perRegel[6] = 'NotoSans'; perRegel[7] = 'NotoSans-Bold'
  perRegel[8] = 'NotoSans'; perRegel[9] = undefined
  perRegel[10] = 'NotoSans'; perRegel[11] = 'NotoSans-Bold'
  perRegel[12] = 'NotoSans-Bold'; perRegel[13] = 'DejaVuSans-Oblique'
  const uit = aliassenUitProbe(k, probe, perRegel)
  assert.deepEqual(uit, {
    'daxpro-bold': { familie: 'DaxPro', vet: true, cursief: false },
    'echt-bold': null,
    'weg-italic': null,
    'noto-bold': null,
    'leeg-bold': undefined,
    'notosans-bold': { familie: 'NotoSans', vet: true, cursief: false },
  })
  assert.ok('leeg-bold' in uit, 'onduidelijk is een expliciete undefined, geen ontbrekende sleutel')
})

test('aliassenUitProbe: zonder controleregel in de PDF is de uitkomst onduidelijk', () => {
  const k = [{ naam: 'DaxPro-Bold', basis: 'DaxPro', vet: true, cursief: false }]
  const uit = aliassenUitProbe(k, probeRuns(k), ['NotoSans', 'DaxPro-Bold'])
  assert.deepEqual(uit, { 'daxpro-bold': undefined })
})

/** Een "render" die een PDF met Helvetica (regel 1), Helvetica-Bold (regel 2) en de opgegeven controle (regel 3) teruggeeft. */
function renderMet(regels) {
  return async () => {
    const pdf = await PDFDocument.create()
    const p = pdf.addPage()
    const fonts = { Helvetica: await pdf.embedFont(StandardFonts.Helvetica), 'Helvetica-Bold': await pdf.embedFont(StandardFonts.HelveticaBold), Courier: await pdf.embedFont(StandardFonts.Courier) }
    regels.forEach((f, i) => { if (f) p.drawText(`Probe${i + 1}`, { x: 50, y: 700 - 20 * i, size: 12, font: fonts[f] }) })
    return { pdf: await pdf.save() }
  }
}

test('probeerLettertypeAliassen: geen kandidaten → geen render; mislukte render → lege aliassen, geen fout, niet gecachet', async () => {
  wisProbeCache()
  const werkmap = await mkdtemp(path.join(os.tmpdir(), 'ds-probe-'))
  try {
    let gerenderd = 0
    const zonder = await probeerLettertypeAliassen({ gevraagd: ['DaxPro', 'DaxPro-Light'], bekendeAliassen: {}, werkmap, render: async () => { gerenderd++; return { pdf: new Uint8Array() } } })
    assert.deepEqual(zonder, { aliassen: {}, onderzocht: [], onduidelijk: [] })
    assert.equal(gerenderd, 0)

    const kapot = await probeerLettertypeAliassen({ gevraagd: ['DaxPro-Bold'], bekendeAliassen: {}, werkmap, render: async () => { throw new RenderFout('MISLUKT', 'kapotte probe') } })
    assert.deepEqual(kapot, { aliassen: {}, onderzocht: ['DaxPro-Bold'], onduidelijk: [] })
    const opnieuw = await probeerLettertypeAliassen({ gevraagd: ['DaxPro-Bold'], bekendeAliassen: {}, werkmap, render: async () => { throw new Error('iets anders') } })
    assert.deepEqual(opnieuw.onderzocht, ['DaxPro-Bold'], 'na een mislukking wordt de volgende keer opnieuw geprobeerd')
  } finally {
    wisProbeCache()
    await rm(werkmap, { recursive: true, force: true })
  }
})

test('probeerLettertypeAliassen: een engine die weg is of hangt wordt doorgegeven, niet ingeslikt', async () => {
  wisProbeCache()
  const werkmap = await mkdtemp(path.join(os.tmpdir(), 'ds-probe-'))
  try {
    for (const soort of ['ONBESCHIKBAAR', 'TIMEOUT']) {
      await assert.rejects(
        probeerLettertypeAliassen({ gevraagd: ['DaxPro-Bold'], bekendeAliassen: {}, werkmap, render: async () => { throw new RenderFout(soort, 'weg') } }),
        (e) => e instanceof RenderFout && e.soort === soort,
      )
    }
  } finally {
    wisProbeCache()
    await rm(werkmap, { recursive: true, force: true })
  }
})

test('probeerLettertypeAliassen: een duidelijke uitkomst wordt gecachet, een onduidelijke niet', async () => {
  wisProbeCache()
  const werkmap = await mkdtemp(path.join(os.tmpdir(), 'ds-probe-'))
  try {
    // "Helvetica-Bold" gevraagd als familie valt terug op Helvetica (regel 1); de
    // basis "Helvetica" + vet levert Helvetica-Bold (regel 2); de controle (regel 3,
    // onbestaand lettertype + vet) valt terug op Courier → alias.
    let gerenderd = 0
    const render = async (...a) => { gerenderd++; return renderMet(['Helvetica', 'Helvetica-Bold', 'Courier'])(...a) }
    const eerste = await probeerLettertypeAliassen({ gevraagd: ['Helvetica-Bold'], bekendeAliassen: {}, werkmap, render })
    assert.deepEqual(eerste, { aliassen: { 'helvetica-bold': { familie: 'Helvetica', vet: true, cursief: false } }, onderzocht: ['Helvetica-Bold'], onduidelijk: [] })
    const tweede = await probeerLettertypeAliassen({ gevraagd: ['Helvetica-Bold', 'Arial'], bekendeAliassen: {}, werkmap, render })
    assert.deepEqual(tweede, { aliassen: { 'helvetica-bold': { familie: 'Helvetica', vet: true, cursief: false } }, onderzocht: [], onduidelijk: [] })
    assert.equal(gerenderd, 1)

    // Basis "Helv" (van "Helv-Bold") valt terug op Helvetica-Bold, net als de controle, en is
    // niet exact de familienaam: géén alias, wél duidelijk → gecachet als null.
    wisProbeCache()
    const vals = await probeerLettertypeAliassen({ gevraagd: ['Helv-Bold'], bekendeAliassen: {}, werkmap, render: renderMet(['Helvetica', 'Helvetica-Bold', 'Helvetica-Bold']) })
    assert.deepEqual(vals.aliassen, {})
    const nogmaals = await probeerLettertypeAliassen({ gevraagd: ['Helv-Bold'], bekendeAliassen: {}, werkmap, render: async () => { throw new Error('mag niet renderen') } })
    assert.deepEqual(nogmaals.onderzocht, [])

    // Basis "Helvetica" is hier zelf de terugval-familie (controle óók Helvetica-Bold), exact → wél een alias.
    wisProbeCache()
    const standaard = await probeerLettertypeAliassen({ gevraagd: ['Helvetica-Bold'], bekendeAliassen: {}, werkmap, render: renderMet(['Helvetica', 'Helvetica-Bold', 'Helvetica-Bold']) })
    assert.deepEqual(standaard.aliassen, { 'helvetica-bold': { familie: 'Helvetica', vet: true, cursief: false } })

    // Controleregel ontbreekt in de PDF: onduidelijk, niet gecachet → volgende keer opnieuw.
    wisProbeCache()
    const vaag = await probeerLettertypeAliassen({ gevraagd: ['Helvetica-Bold'], bekendeAliassen: {}, werkmap, render: renderMet(['Helvetica', 'Helvetica-Bold', null]) })
    assert.deepEqual(vaag, { aliassen: {}, onderzocht: ['Helvetica-Bold'], onduidelijk: ['helvetica-bold'] })
    const herkansing = await probeerLettertypeAliassen({ gevraagd: ['Helvetica-Bold'], bekendeAliassen: {}, werkmap, render: renderMet(['Helvetica', 'Helvetica-Bold', 'Courier']) })
    assert.deepEqual(herkansing.onderzocht, ['Helvetica-Bold'])
    assert.deepEqual(Object.keys(herkansing.aliassen), ['helvetica-bold'])
  } finally {
    wisProbeCache()
    await rm(werkmap, { recursive: true, force: true })
  }
})
