// Gekoppelde afbeeldingen (E:\… op een Motrac-pc) vóór de render insluiten uit
// de afbeeldingenmap op de server — zie lib/gekoppeldeAfbeeldingen.js. Pure
// logica plus een tijdelijke map, geen LibreOffice.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  bestandsnaamUitDoel,
  gekoppeldeAfbeeldingenInDocx,
  gekoppeldeBeeldrelaties,
  zoekAfbeeldingen,
} from '../lib/gekoppeldeAfbeeldingen.js'
import { voorbewerkDocx } from '../lib/docxVoorbewerking.js'

const E_SCHIJF = "file:///E:\\Motrac%20Intern%20Transport%20BV\\Afdelingen\\Sales\\Algemeen%20Sales%20Support\\Standaardbestanden%20BID\\Foto's\\AFBEELDINGEN%20CPQ\\1254_00_E50-600_BASIC_WEB_0002.png"
const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const RELS = '<Relationships>'
  + `<Relationship Id="rId17" Type="${IMG}" Target="${E_SCHIJF}" TargetMode="External"/>`
  + `<Relationship Id="rId18" Type="${IMG}" Target="https://cdn.example/foto.png" TargetMode="External"/>`
  + `<Relationship Id="rId19" Type="${IMG}" Target="media/image1.png"/>`
  + '<Relationship Id="rId20" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="file:///E:\\x.png" TargetMode="External"/>'
  + '</Relationships>'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function maakDocx() {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    'word/document.xml': strToU8('<w:body><w:p><w:r><w:drawing><a:blip r:link="rId17"/></w:drawing></w:r><w:r><w:drawing><a:blip r:embed="rId19"/></w:drawing></w:r></w:p></w:body>'),
    'word/_rels/document.xml.rels': strToU8(RELS),
    'word/media/image1.png': PNG,
  })
}

test('bestandsnaamUitDoel: alleen de naam, uit file://, UNC en gewone paden; geen beeld → null', () => {
  assert.equal(bestandsnaamUitDoel(E_SCHIJF), '1254_00_E50-600_BASIC_WEB_0002.png')
  assert.equal(bestandsnaamUitDoel('\\\\server\\deel\\Map\\Foto.JPG'), 'Foto.JPG')
  assert.equal(bestandsnaamUitDoel('../../etc/passwd'), null)
  assert.equal(bestandsnaamUitDoel('file:///E:\\a%ZZ\\b.png'), 'b.png', 'ongeldige %-reeks mag niet crashen')
})

test('gekoppeldeBeeldrelaties: alleen externe beeldrelaties die geen webadres zijn', () => {
  const r = gekoppeldeBeeldrelaties(RELS)
  assert.deepEqual(r.map((x) => [x.id, x.naam]), [['rId17', '1254_00_E50-600_BASIC_WEB_0002.png']])
})

test('gekoppeldeAfbeeldingenInDocx leest de .rels; kapotte zip geeft een lege lijst', () => {
  assert.deepEqual(gekoppeldeAfbeeldingenInDocx(maakDocx()), ['1254_00_E50-600_BASIC_WEB_0002.png'])
  assert.deepEqual(gekoppeldeAfbeeldingenInDocx(new Uint8Array([1, 2, 3])), [])
})

test('zoekAfbeeldingen: hoofdletterongevoelig, ook in submappen; de rest is ontbrekend', async () => {
  const map = await mkdtemp(path.join(os.tmpdir(), 'ds-afb-'))
  try {
    await mkdir(path.join(map, 'AFBEELDINGEN CPQ'))
    await writeFile(path.join(map, 'AFBEELDINGEN CPQ', '1254_00_e50-600_basic_web_0002.PNG'), PNG)
    const r = await zoekAfbeeldingen(['1254_00_E50-600_BASIC_WEB_0002.png', 'bestaat-niet.jpg'], [map, path.join(map, 'geen-map')])
    assert.deepEqual(Object.keys(r.gevonden), ['1254_00_e50-600_basic_web_0002.png'])
    assert.deepEqual(r.gevonden['1254_00_e50-600_basic_web_0002.png'], PNG)
    assert.deepEqual(r.ontbrekend, ['bestaat-niet.jpg'])
  } finally {
    await rm(map, { recursive: true, force: true })
  }
})

test('voorbewerkDocx sluit een gevonden gekoppelde afbeelding in: media, interne relatie, r:embed, content type', () => {
  const r = voorbewerkDocx(maakDocx(), { afbeeldingen: { '1254_00_e50-600_basic_web_0002.png': PNG } })
  assert.equal(r.afbeeldingenIngesloten, 1)
  const d = unzipSync(r.docx)
  assert.deepEqual(d['word/media/gekoppeld-1.png'], PNG)
  const rels = strFromU8(d['word/_rels/document.xml.rels'])
  assert.ok(rels.includes(`<Relationship Id="rId17" Type="${IMG}" Target="media/gekoppeld-1.png"/>`))
  assert.ok(rels.includes('Target="https://cdn.example/foto.png" TargetMode="External"'), 'webadres blijft gekoppeld')
  const doc = strFromU8(d['word/document.xml'])
  assert.ok(doc.includes('<a:blip r:embed="rId17"/>') && !doc.includes('r:link'))
  assert.ok(doc.includes('<a:blip r:embed="rId19"/>'))
  assert.ok(strFromU8(d['[Content_Types].xml']).includes('<Default Extension="png" ContentType="image/png"/>'))
  assert.deepEqual(d['word/media/image1.png'], PNG, 'bestaande media ongemoeid')
})

test('zonder gevonden afbeeldingen blijft de koppeling zoals hij was', () => {
  const r = voorbewerkDocx(maakDocx())
  assert.equal(r.afbeeldingenIngesloten, 0)
  const d = unzipSync(r.docx)
  assert.equal(strFromU8(d['word/_rels/document.xml.rels']), RELS)
  assert.ok(strFromU8(d['word/document.xml']).includes('r:link="rId17"'))
})
