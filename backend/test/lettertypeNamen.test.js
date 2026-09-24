// Lettertypenamen die LibreOffice niet als familie vindt (DaxPro-Bold: alleen
// een PostScript-naam), omzetten naar familie + snit — zie lib/lettertypeNamen.js
// en lettertypeAliassen() in lib/lettertypen.js. Pure logica, geen LibreOffice.
import assert from 'node:assert/strict'
import test from 'node:test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { lettertypeAliassen } from '../lib/lettertypen.js'
import { pasLettertypeAliassenToe } from '../lib/lettertypeNamen.js'
import { voorbewerkDocx } from '../lib/docxVoorbewerking.js'

// Zoals de DaxPro-bestanden zich voor fontconfig melden (afgeleid van de PDF
// van 2026-09-24): Light/Medium hebben een eigen familienaam, Bold niet.
const BESTANDEN = [
  { families: ['DaxPro'], snitten: [{ 1: 'DaxPro', 2: 'Regular', 6: 'DaxPro' }] },
  { families: ['DaxPro'], snitten: [{ 1: 'DaxPro', 2: 'Bold', 6: 'DaxPro-Bold' }] },
  { families: ['DaxPro-Light', 'DaxPro'], snitten: [{ 1: 'DaxPro-Light', 2: 'Regular', 6: 'DaxPro-Light', 16: 'DaxPro', 17: 'Light' }] },
  { families: ['Voorbeeld'], snitten: [{ 1: 'Voorbeeld', 2: 'Bold Italic', 6: 'Voorbeeld-BoldItalic' }] },
]
const ALIASSEN = lettertypeAliassen(BESTANDEN)

test('lettertypeAliassen: alleen PostScript-namen die geen familie zijn, met de snit', () => {
  assert.deepEqual(ALIASSEN, {
    'daxpro-bold': { familie: 'DaxPro', vet: true, cursief: false },
    'voorbeeld-bolditalic': { familie: 'Voorbeeld', vet: true, cursief: true },
  })
})

test('lettertypeAliassen: een snit die DOCX niet kan vragen (Light onder DaxPro) blijft staan', () => {
  const alleenTypografisch = [{ families: ['DaxPro Light', 'DaxPro'], snitten: [{ 1: 'DaxPro Light', 2: 'Regular', 6: 'DaxPro-Light', 16: 'DaxPro', 17: 'Light' }] }]
  assert.deepEqual(lettertypeAliassen(alleenTypografisch), {})
})

test('zet DaxPro-Bold om naar DaxPro + vet, in alle rFonts-attributen met die naam', () => {
  const xml = '<w:r><w:rPr><w:rFonts w:ascii="DaxPro-Bold" w:hAnsi="DaxPro-Bold" w:cs="Arial"/><w:sz w:val="18"/></w:rPr><w:t>John</w:t></w:r>'
  const r = pasLettertypeAliassenToe(xml, ALIASSEN)
  assert.equal(r.xml, '<w:r><w:rPr><w:rFonts w:ascii="DaxPro" w:hAnsi="DaxPro" w:cs="Arial"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>John</w:t></w:r>')
  assert.deepEqual(r.omgezet, { 'DaxPro-Bold': 1 })
})

test('bestaand vet blijft één <w:b/>; expliciet niet-vet wordt vet', () => {
  const vet = pasLettertypeAliassenToe('<w:rPr><w:rFonts w:ascii="DaxPro-Bold"/><w:b/></w:rPr>', ALIASSEN).xml
  assert.equal(vet, '<w:rPr><w:rFonts w:ascii="DaxPro"/><w:b/></w:rPr>')
  const nietVet = pasLettertypeAliassenToe('<w:rPr><w:rFonts w:ascii="DaxPro-Bold"/><w:b w:val="0"/></w:rPr>', ALIASSEN).xml
  assert.equal(nietVet, '<w:rPr><w:rFonts w:ascii="DaxPro"/><w:b/></w:rPr>')
})

test('cursief komt na b/bCs, in schemavolgorde', () => {
  const r = pasLettertypeAliassenToe('<w:rPr><w:rStyle w:val="X"/><w:rFonts w:ascii="Voorbeeld-BoldItalic"/><w:bCs/><w:color w:val="FF0000"/></w:rPr>', ALIASSEN)
  assert.equal(r.xml, '<w:rPr><w:rStyle w:val="X"/><w:rFonts w:ascii="Voorbeeld"/><w:b/><w:bCs/><w:i/><w:color w:val="FF0000"/></w:rPr>')
})

test('laat andere lettertypen en een alias die alleen in w:cs staat ongemoeid', () => {
  const xml = '<w:rPr><w:rFonts w:ascii="DaxPro-Light" w:hAnsi="DaxPro-Light"/></w:rPr><w:rPr><w:rFonts w:ascii="DaxPro" w:cs="DaxPro-Bold"/></w:rPr>'
  assert.deepEqual(pasLettertypeAliassenToe(xml, ALIASSEN), { xml, omgezet: {} })
  assert.deepEqual(pasLettertypeAliassenToe(xml, {}), { xml, omgezet: {} })
})

test('voorbewerkDocx past de aliassen toe op document én styles.xml, en meldt het lettertype zoals LO het krijgt', () => {
  const docx = zipSync({
    'word/document.xml': strToU8('<w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="DaxPro-Bold" w:hAnsi="DaxPro-Bold"/></w:rPr><w:t>Datum:</w:t></w:r></w:p></w:body>'),
    'word/styles.xml': strToU8('<w:styles><w:style w:type="paragraph" w:styleId="Kop"><w:rPr><w:rFonts w:ascii="DaxPro-Bold" w:hAnsi="DaxPro-Bold"/></w:rPr></w:style></w:styles>'),
  })
  const r = voorbewerkDocx(docx, { lettertypeAliassen: ALIASSEN })
  const delen = unzipSync(r.docx)
  assert.ok(strFromU8(delen['word/document.xml']).includes('<w:rFonts w:ascii="DaxPro" w:hAnsi="DaxPro"/><w:b/>'))
  assert.ok(strFromU8(delen['word/styles.xml']).includes('<w:rFonts w:ascii="DaxPro" w:hAnsi="DaxPro"/><w:b/>'))
  assert.deepEqual(r.lettertypenOmgezet, { 'DaxPro-Bold': 2 })
  assert.deepEqual(r.lettertypen, ['DaxPro'])
})

test('zonder aliassen gaat styles.xml byte-voor-byte mee', () => {
  const styles = strToU8('<w:styles><w:style w:styleId="Kop"><w:rPr><w:rFonts w:ascii="DaxPro-Bold"/></w:rPr></w:style></w:styles>')
  const r = voorbewerkDocx(zipSync({ 'word/document.xml': strToU8('<w:body/>'), 'word/styles.xml': styles }))
  assert.deepEqual(unzipSync(r.docx)['word/styles.xml'], styles)
  assert.deepEqual(r.lettertypenOmgezet, {})
})
