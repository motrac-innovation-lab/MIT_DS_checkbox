// Alinea's in een tekstvak krijgen de standaardstijl expliciet mee, zodat
// LibreOffice er niet de docDefaults (thema-lettertype Calibri) op zet — zie
// lib/tekstvakStijl.js. Pure logica — geen database, geen LibreOffice.
import assert from 'node:assert/strict'
import test from 'node:test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { standaardAlineastijl, standaardstijlInTekstvakken } from '../lib/tekstvakStijl.js'
import { voorbewerkDocx } from '../lib/docxVoorbewerking.js'

const PSTYLE = '<w:pStyle w:val="Standaard"/>'
const tel = (hooi, naald) => hooi.split(naald).length - 1

test('standaardAlineastijl vindt de paragraph-stijl met w:default="1", in elke attribuutvolgorde', () => {
  const styles = '<w:styles>'
    + '<w:style w:type="character" w:default="1" w:styleId="Standaardalinea-lettertype"/>'
    + '<w:style w:styleId="Standaard" w:default="1" w:type="paragraph"><w:name w:val="Normal"/></w:style>'
    + '</w:styles>'
  assert.equal(standaardAlineastijl(styles), 'Standaard')
  assert.equal(standaardAlineastijl('<w:styles/>'), null)
  assert.equal(standaardAlineastijl(undefined), null)
})

test('zet de standaardstijl op alinea\'s in een tekstvak zonder eigen stijl', () => {
  const xml = '<w:body><w:p><w:r><w:t>buiten</w:t></w:r></w:p>'
    + '<w:p><w:r><w:drawing><wps:txbx><w:txbxContent>'
    + '<w:p w14:paraId="1"><w:r><w:t>geen pPr</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>pPr zonder stijl</w:t></w:r></w:p>'
    + '<w:p><w:pPr/><w:r><w:t>lege pPr</w:t></w:r></w:p>'
    + '<w:p/>'
    + '<w:p><w:pPr><w:pStyle w:val="Kop1"/></w:pPr><w:r><w:t>eigen stijl</w:t></w:r></w:p>'
    + '</w:txbxContent></wps:txbx></w:drawing></w:r></w:p></w:body>'
  const r = standaardstijlInTekstvakken(xml, 'Standaard')
  assert.equal(r.aangepast, 4)
  assert.ok(r.xml.includes(`<w:p w14:paraId="1"><w:pPr>${PSTYLE}</w:pPr><w:r>`))
  assert.ok(r.xml.includes(`<w:pPr>${PSTYLE}<w:jc w:val="center"/></w:pPr>`), 'pStyle hoort als eerste kind van pPr')
  assert.ok(r.xml.includes(`<w:p><w:pPr>${PSTYLE}</w:pPr><w:r><w:t>lege pPr`))
  assert.ok(r.xml.includes(`<w:p><w:pPr>${PSTYLE}</w:pPr></w:p>`), 'zelfsluitende alinea')
  assert.ok(r.xml.includes('<w:pStyle w:val="Kop1"/>') && !r.xml.includes(`${PSTYLE}<w:pStyle`))
  assert.ok(r.xml.startsWith('<w:body><w:p><w:r><w:t>buiten'), 'buiten een tekstvak niets aanpassen')
})

test('telt geneste tekstvakken mee en laat <w:pict>/<w:pPr> met rust', () => {
  const xml = '<w:txbxContent><w:p><w:r><w:pict><w:txbxContent><w:p/></w:txbxContent></w:pict></w:r></w:p>'
    + '<w:p><w:r><w:t>na binnenste</w:t></w:r></w:p></w:txbxContent><w:p><w:r><w:t>buiten</w:t></w:r></w:p>'
  const r = standaardstijlInTekstvakken(xml, 'Standaard')
  assert.equal(r.aangepast, 3)
  assert.equal(tel(r.xml, PSTYLE), 3)
  assert.ok(r.xml.endsWith('<w:p><w:r><w:t>buiten</w:t></w:r></w:p>'))
})

test('zonder standaardstijl of zonder tekstvakken verandert er niets', () => {
  const xml = '<w:txbxContent><w:p/></w:txbxContent>'
  assert.deepEqual(standaardstijlInTekstvakken(xml, null), { xml, aangepast: 0 })
  const zonder = '<w:body><w:p/></w:body>'
  assert.deepEqual(standaardstijlInTekstvakken(zonder, 'Standaard'), { xml: zonder, aangepast: 0 })
})

test('voorbewerkDocx leest de standaardstijl uit styles.xml en telt de alinea\'s', () => {
  const docx = zipSync({
    'word/document.xml': strToU8('<w:body><w:p><w:r><w:txbxContent><w:p><w:r><w:t>Motrac op maat</w:t></w:r></w:p></w:txbxContent></w:r></w:p></w:body>'),
    'word/styles.xml': strToU8('<w:styles><w:style w:type="paragraph" w:default="1" w:styleId="Standaard"><w:rPr><w:rFonts w:ascii="DaxPro-Light" w:hAnsi="DaxPro-Light"/></w:rPr></w:style></w:styles>'),
  })
  const r = voorbewerkDocx(docx)
  assert.equal(r.tekstvakAlineas, 1)
  assert.ok(strFromU8(unzipSync(r.docx)['word/document.xml']).includes(PSTYLE))
  assert.deepEqual(r.lettertypen, ['DaxPro-Light'])
})
