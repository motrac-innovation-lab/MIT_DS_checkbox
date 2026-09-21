// Port van DocxPreprocessorTest.java uit esign_motrac: de symbool-runs die een
// checkbox voorstellen worden ☐, in body én kop-/voetteksten, en al het andere
// in de zip gaat byte-voor-byte mee. Pure logica — geen database, geen
// LibreOffice.
import assert from 'node:assert/strict'
import test from 'node:test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  DocxOngeldig,
  VERVANGING,
  isTransformeerbaarWordPart,
  transformeerDocumentXml,
  voorbewerkDocx,
} from '../lib/docxVoorbewerking.js'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const SYM = '<w:sym w:font="Wingdings 2" w:char="F0A3"/>'

function tel(haystack, needle) {
  return haystack.split(needle).length - 1
}

function maakDocx(onderdelen) {
  return zipSync(Object.fromEntries(Object.entries(onderdelen).map(([k, v]) => [k, strToU8(v)])))
}

function lees(docx, naam) {
  const entry = unzipSync(docx)[naam]
  assert.ok(entry, `onderdeel ${naam} ontbreekt`)
  return strFromU8(entry)
}

test('vervangt Wingdings 2 F0A3-symboolruns door een ☐-tekstrun, in beide attribuutvolgordes', () => {
  const xml = '<w:body>'
    + `<w:p><w:r>${SYM}</w:r></w:p>`
    + '<w:p><w:r><w:sym w:char="F0A3" w:font="Wingdings 2"/></w:r></w:p>'
    + '<w:p><w:r><w:t>geen checkbox</w:t></w:r></w:p>'
    + '</w:body>'
  const r = transformeerDocumentXml(xml)
  assert.equal(r.vervangingen, 2)
  assert.ok(!r.xml.includes('<w:sym'))
  assert.equal(tel(r.xml, VERVANGING), 2)
  assert.ok(r.xml.includes('geen checkbox'))
})

test('matcht ongeacht hoofd-/kleine letters in fontnaam en hex-code', () => {
  const xml = '<w:body><w:r><w:sym w:font="wingdings 2" w:char="f0a3"/></w:r><w:r><w:sym w:char="f0A3" w:font="WINGDINGS 2"/></w:r></w:body>'
  const r = transformeerDocumentXml(xml)
  assert.equal(r.vervangingen, 2)
  assert.ok(!r.xml.includes('<w:sym'))
})

test('laat andere symbolen staan', () => {
  const xml = '<w:body><w:r><w:sym w:font="Wingdings" w:char="F06F"/></w:r><w:r><w:sym w:font="Wingdings 2" w:char="F0A1"/></w:r></w:body>'
  const r = transformeerDocumentXml(xml)
  assert.equal(r.vervangingen, 0)
  assert.equal(r.xml, xml)
})

test('herkent precies de body-, header- en footer-onderdelen', () => {
  for (const naam of ['word/document.xml', 'word/header.xml', 'word/header1.xml', 'word/header42.xml', 'word/footer.xml', 'word/footer1.xml']) {
    assert.ok(isTransformeerbaarWordPart(naam), naam)
  }
  for (const naam of ['word/styles.xml', 'word/settings.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml', 'word/documentX.xml', null]) {
    assert.ok(!isTransformeerbaarWordPart(naam), String(naam))
  }
})

test('transformeert body, headers en footers en kopieert de rest byte-voor-byte', () => {
  const header = `<?xml version="1.0"?><w:hdr ${W}><w:p><w:r>${SYM}</w:r></w:p></w:hdr>`
  const footer = `<?xml version="1.0"?><w:ftr ${W}><w:p><w:r>${SYM}</w:r></w:p><w:p><w:r>${SYM}</w:r></w:p></w:ftr>`
  const body = `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r>${SYM}</w:r></w:p><w:p><w:r><w:t>Klantgegevens</w:t></w:r></w:p></w:body></w:document>`
  const styles = `<?xml version="1.0"?><w:styles ${W}>${SYM}</w:styles>`
  const rels = '<?xml version="1.0"?><Relationships/>'

  const uit = voorbewerkDocx(maakDocx({
    'word/document.xml': body,
    'word/header1.xml': header,
    'word/footer1.xml': footer,
    'word/footer2.xml': footer,
    'word/styles.xml': styles,
    'word/_rels/document.xml.rels': rels,
  }))

  assert.equal(uit.vervangingen, 6, '1 (body) + 1 (header1) + 2 (footer1) + 2 (footer2)')
  for (const naam of ['word/document.xml', 'word/header1.xml', 'word/footer1.xml', 'word/footer2.xml']) {
    assert.ok(!lees(uit.docx, naam).includes('<w:sym'), `${naam} bevat nog een sym`)
  }
  assert.ok(lees(uit.docx, 'word/document.xml').includes('Klantgegevens'))
  // styles.xml en de rels zijn geen doel van de transformatie: byte-identiek terug.
  assert.equal(lees(uit.docx, 'word/styles.xml'), styles)
  assert.equal(lees(uit.docx, 'word/_rels/document.xml.rels'), rels)
})

test('verzamelt de gevraagde lettertypen uit runs, docDefaults en de basedOn-keten van gebruikte stijlen', () => {
  const body = `<w:document ${W}><w:body>`
    + '<w:p><w:pPr><w:pStyle w:val="Kop1"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="DaxPro-Medium" w:hAnsi="DaxPro-Medium"/></w:rPr><w:t>Offerte</w:t></w:r></w:p>'
    + '<w:p><w:r><w:rPr><w:rStyle w:val="Nadruk"/></w:rPr><w:t>tekst</w:t></w:r></w:p>'
    + `<w:p><w:r><w:rPr><w:rFonts w:ascii="Wingdings 2"/></w:rPr>${SYM}</w:r></w:p>`
    + '</w:body></w:document>'
  const styles = `<w:styles ${W}>`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="DaxPro" w:hAnsi="DaxPro" w:cs="Times New Roman"/></w:rPr></w:rPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:styleId="Kop1"><w:basedOn w:val="Standaard"/><w:rPr><w:rFonts w:ascii="DaxPro-Light"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Standaard"><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr></w:style>'
    + '<w:style w:type="character" w:styleId="Nadruk"><w:rPr><w:rFonts w:ascii="Georgia"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Ongebruikt"><w:rPr><w:rFonts w:ascii="Comic Sans MS"/></w:rPr></w:style>'
    + '</w:styles>'
  const uit = voorbewerkDocx(maakDocx({ 'word/document.xml': body, 'word/styles.xml': styles }))
  assert.deepEqual(uit.lettertypen, ['Calibri', 'DaxPro', 'DaxPro-Light', 'DaxPro-Medium', 'Georgia', 'Times New Roman'])
  assert.ok(!uit.lettertypen.includes('Wingdings 2'), 'symboollettertypen tellen niet mee')
  assert.ok(!uit.lettertypen.includes('Comic Sans MS'), 'een ongebruikte stijl telt niet mee')
})

test('weigert wat geen docx is', () => {
  assert.throws(() => voorbewerkDocx(strToU8('dit is geen zip')), DocxOngeldig)
  assert.throws(() => voorbewerkDocx(maakDocx({ 'iets.txt': 'zip zonder word/document.xml' })), DocxOngeldig)
})
