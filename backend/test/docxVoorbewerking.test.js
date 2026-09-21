// Port van DocxPreprocessorTest.java uit esign_motrac: de symbool-runs die een
// checkbox voorstellen worden ☐, in body én kop-/voetteksten, en al het andere
// in de zip gaat byte-voor-byte mee. Pure logica — geen database, geen
// LibreOffice.
import assert from 'node:assert/strict'
import test from 'node:test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  DocxOngeldig,
  STANDAARD_ALIASSEN,
  VERVANGING,
  isLettertypePart,
  isTransformeerbaarWordPart,
  lettertypeAliassen,
  pasLettertypeAliassenToe,
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

// ---- Lettertype-aliassen -------------------------------------------------
//
// Het Motrac-sjabloon zet `LindeDaxOffice` op de opsommingstekens in
// word/numbering.xml. Dat lettertype bestaat nergens als bestand — het
// document draagt er zelfs `<w:altName w:val="Calibri"/>` bij — dus de
// bolletjes vielen in Calibri. Mark (2026-09-21): dit moet DaxPro worden.

test('vervangt een alias in elk w:rFonts-attribuut, ongeacht schrijfwijze', () => {
  const xml = '<w:p><w:rPr><w:rFonts w:ascii="LindeDaxOffice" w:hAnsi="lindedaxoffice" w:cs="Linde Dax Office" w:eastAsia="Times New Roman"/></w:rPr></w:p>'
  const r = pasLettertypeAliassenToe(xml, { LindeDaxOffice: 'DaxPro' })
  assert.equal(r.vervangingen, 3, 'ascii, hAnsi en cs — eastAsia staat op een ander lettertype')
  assert.ok(!r.xml.includes('LindeDaxOffice'))
  assert.ok(!/lindedaxoffice/i.test(r.xml))
  assert.ok(r.xml.includes('w:eastAsia="Times New Roman"'), 'andere lettertypen blijven staan')
  assert.equal((r.xml.match(/"DaxPro"/g) ?? []).length, 3)
})

test('zonder aliassen verandert er niets', () => {
  const xml = '<w:rFonts w:ascii="LindeDaxOffice"/>'
  for (const leeg of [{}, undefined, null]) {
    const r = pasLettertypeAliassenToe(xml, leeg)
    assert.equal(r.vervangingen, 0)
    assert.equal(r.xml, xml)
  }
})

test('de aliaslijst is met een env-var te overschrijven', () => {
  const oud = process.env.LETTERTYPE_ALIASSEN
  try {
    delete process.env.LETTERTYPE_ALIASSEN
    assert.deepEqual(lettertypeAliassen(), STANDAARD_ALIASSEN)

    process.env.LETTERTYPE_ALIASSEN = 'Oud=Nieuw, Tweede = Ander '
    assert.deepEqual(lettertypeAliassen(), { Oud: 'Nieuw', Tweede: 'Ander' })

    // Leeg zet alle aliassen uit; dat moet kunnen zonder codewijziging.
    process.env.LETTERTYPE_ALIASSEN = ''
    assert.deepEqual(lettertypeAliassen(), {})
  } finally {
    if (oud === undefined) delete process.env.LETTERTYPE_ALIASSEN
    else process.env.LETTERTYPE_ALIASSEN = oud
  }
})

test('herkent de onderdelen waarin lettertypen kunnen staan', () => {
  for (const naam of ['word/document.xml', 'word/header1.xml', 'word/footer2.xml', 'word/styles.xml', 'word/numbering.xml', 'word/footnotes.xml', 'word/endnotes.xml']) {
    assert.ok(isLettertypePart(naam), naam)
  }
  for (const naam of ['word/fontTable.xml', 'word/settings.xml', 'word/theme/theme1.xml', '[Content_Types].xml', null]) {
    assert.ok(!isLettertypePart(naam), String(naam))
  }
})

test('past de alias toe op numbering.xml en styles.xml, en laat fontTable met rust', () => {
  const numbering = `<w:numbering ${W}><w:lvl><w:rPr><w:rFonts w:ascii="LindeDaxOffice" w:hAnsi="LindeDaxOffice"/></w:rPr></w:lvl></w:numbering>`
  const styles = `<w:styles ${W}><w:style w:styleId="Lijst"><w:rPr><w:rFonts w:ascii="LindeDaxOffice"/></w:rPr></w:style></w:styles>`
  // Zoals in een echte offerte: de fontTable beschrijft het lettertype en
  // wijst zelf naar Calibri. Die tabel is geen verwijzing, dus hij blijft.
  const fontTable = `<w:fonts ${W}><w:font w:name="LindeDaxOffice"><w:altName w:val="Calibri"/></w:font></w:fonts>`
  // De alinea gebruikt de stijl "Lijst", zodat de verzamelde lettertypen via
  // de stijlketen lopen. Zo controleert deze test meteen de volgorde: de
  // alias wordt toegepast VOOR de lettertypen verzameld worden.
  const body = `<w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Lijst"/></w:pPr><w:r><w:t>tekst</w:t></w:r></w:p></w:body></w:document>`

  const uit = voorbewerkDocx(maakDocx({
    'word/document.xml': body,
    'word/numbering.xml': numbering,
    'word/styles.xml': styles,
    'word/fontTable.xml': fontTable,
  }))

  assert.equal(uit.aliassenToegepast, 3, '2 in numbering, 1 in styles')
  assert.ok(!lees(uit.docx, 'word/numbering.xml').includes('LindeDaxOffice'))
  assert.ok(!lees(uit.docx, 'word/styles.xml').includes('LindeDaxOffice'))
  assert.equal(lees(uit.docx, 'word/fontTable.xml'), fontTable, 'fontTable blijft byte-identiek')
  // De hernoemde naam telt mee als gevraagd lettertype, de oude niet meer.
  assert.deepEqual(uit.lettertypen, ['DaxPro'])
})

test('een onderdeel zonder treffer komt byte-identiek terug', () => {
  // Zonder deze garantie zou elk bekeken onderdeel opnieuw geserialiseerd
  // worden, en dan is niet meer te zien wat de voorbewerking echt veranderde.
  const numbering = `<w:numbering ${W}><w:lvl><w:rPr><w:rFonts w:ascii="DaxPro"/></w:rPr></w:lvl></w:numbering>`
  const bron = { 'word/document.xml': `<w:document ${W}><w:body/></w:document>`, 'word/numbering.xml': numbering }
  const uit = voorbewerkDocx(maakDocx(bron))
  assert.equal(uit.aliassenToegepast, 0)
  assert.equal(lees(uit.docx, 'word/numbering.xml'), numbering)
})
