// Opvulspaties in een tabelcel → rechts uitlijnen (lib/opvulspaties.js).
// Aanleiding: "Netto prijs per truck" waar "€ 86.519,99" na 143 spaties naar
// de volgende regel sprong. Pure logica, geen LibreOffice. De randgevallen
// komen uit de adversariële review van 2026-09-24.
import assert from 'node:assert/strict'
import test from 'node:test'
import { OPVUL_MINIMUM, celAlineas, opvulspatiesNaarRechts } from '../lib/opvulspaties.js'

const RPR = '<w:rPr><w:b/><w:sz w:val="18"/></w:rPr>'
const run = (t) => `<w:r>${RPR}<w:t xml:space="preserve">${t}</w:t></w:r>`
const cel = (p) => `<w:tc><w:tcPr><w:tcW w:w="7938" w:type="dxa"/></w:tcPr>${p}</w:tc>`
const S = (n) => ' '.repeat(n)

test('de Netto-prijs-cel: tab + 114 + 29 spaties + bedrag, uitgevuld → rechts uitgelijnd, alleen het bedrag', () => {
  const p = `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="6126"/></w:tabs><w:jc w:val="both"/>${RPR}</w:pPr>`
    + `<w:r>${RPR}<w:tab/></w:r>${run(S(114))}${run(S(29))}<w:r>${RPR}<w:t>€ 86.519,99</w:t></w:r></w:p>`
  const r = opvulspatiesNaarRechts(`<w:tbl><w:tr>${cel(p)}</w:tr></w:tbl>`)
  assert.equal(r.aangepast, 1)
  assert.equal(r.xml, `<w:tbl><w:tr>${cel(`<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="6126"/></w:tabs><w:jc w:val="right"/>${RPR}</w:pPr><w:r>${RPR}<w:t>€ 86.519,99</w:t></w:r></w:p>`)}</w:tr></w:tbl>`)
})

test('spaties (en een tab) in dezelfde run als de tekst worden weggeknipt; zonder w:jc komt hij vóór w:rPr, zonder pPr wordt hij aangemaakt', () => {
  const p = `<w:p><w:pPr>${RPR}</w:pPr><w:r>${RPR}<w:tab/><w:t xml:space="preserve">${S(OPVUL_MINIMUM)}€ 14,39</w:t></w:r></w:p>`
  const r = opvulspatiesNaarRechts(cel(p))
  assert.equal(r.aangepast, 1)
  assert.equal(r.xml, cel(`<w:p><w:pPr><w:jc w:val="right"/>${RPR}</w:pPr><w:r>${RPR}<w:t xml:space="preserve">€ 14,39</w:t></w:r></w:p>`))
  const zonderPpr = opvulspatiesNaarRechts(cel(`<w:p>${run(S(30) + 'x')}</w:p>`))
  assert.equal(zonderPpr.xml, cel(`<w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run('x')}</w:p>`))
  const legePpr = opvulspatiesNaarRechts(cel(`<w:p><w:pPr/>${run(S(30) + 'x')}</w:p>`))
  assert.equal(legePpr.xml, cel(`<w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run('x')}</w:p>`))
})

test('w:jc komt in de pPr, nooit in een run — ook als de pPr zelf geen w:rPr heeft en de run wel', () => {
  const p = `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run(S(40) + '€ 1,00')}</w:p>`
  const r = opvulspatiesNaarRechts(cel(p))
  assert.equal(r.xml, cel(`<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/></w:pPr>${run('€ 1,00')}</w:p>`))
})

test('met wijzigingen bijhouden (pPrChange) komt w:jc in de levende pPr, niet in de oude', () => {
  const p = `<w:p><w:pPr><w:spacing w:after="0"/><w:pPrChange w:id="1" w:author="x" w:date="2026-01-01T00:00:00Z"><w:pPr/></w:pPrChange></w:pPr>${run(S(40) + '€ 1,00')}</w:p>`
  const r = opvulspatiesNaarRechts(cel(p))
  assert.equal(r.xml, cel(`<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/><w:pPrChange w:id="1" w:author="x" w:date="2026-01-01T00:00:00Z"><w:pPr/></w:pPrChange></w:pPr>${run('€ 1,00')}</w:p>`))
  const genest = `<w:p><w:pPr><w:pPrChange w:id="2" w:author="x" w:date="2026-01-01T00:00:00Z"><w:pPr><w:jc w:val="center"/></w:pPr></w:pPrChange></w:pPr>${run(S(40) + '€ 1,00')}</w:p>`
  const r2 = opvulspatiesNaarRechts(cel(genest))
  assert.equal(r2.xml, cel(`<w:p><w:pPr><w:jc w:val="right"/><w:pPrChange w:id="2" w:author="x" w:date="2026-01-01T00:00:00Z"><w:pPr><w:jc w:val="center"/></w:pPr></w:pPrChange></w:pPr>${run('€ 1,00')}</w:p>`))
})

test('tekst die Word over meerdere runs verdeelde ("€ " + "86.519,99") telt als één tekst', () => {
  const p = `<w:p>${run(S(40))}${run('€ ')}<w:proofErr w:type="spellStart"/>${run('86.519,99')}<w:proofErr w:type="spellEnd"/></w:p>`
  const r = opvulspatiesNaarRechts(cel(p))
  assert.equal(r.aangepast, 1)
  assert.equal(r.xml, cel(`<w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run('€ ')}<w:proofErr w:type="spellStart"/>${run('86.519,99')}<w:proofErr w:type="spellEnd"/></w:p>`))
})

test('"download brochure [PDF]" als hyperlink achter 82 spaties telt wél', () => {
  const a = `<w:p>${run(S(82))}<w:hyperlink r:id="rId9" w:history="1">${run('download brochure [PDF]')}</w:hyperlink></w:p>`
  const b = `<w:p>${run('gewone tekst')}</w:p>`
  const r = opvulspatiesNaarRechts(`<w:tr>${cel(a)}${cel(b)}</w:tr>`)
  assert.equal(r.aangepast, 1)
  assert.ok(r.xml.includes(`<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:hyperlink r:id="rId9" w:history="1">${run('download brochure [PDF]')}</w:hyperlink></w:p>`), r.xml)
  assert.ok(r.xml.includes(b))
})

test('blijft staan: te weinig spaties, tekst vóór de spaties, tab of tweede gat erna, symbool/tekening/veld/regeleinde/positietab, verwijzingen in de weg te halen runs, buiten een tabel', () => {
  const gevallen = [
    `<w:p>${run(S(OPVUL_MINIMUM - 1) + '€ 1,00')}</w:p>`,
    `<w:p>${run('Ondertekening:')}${run(S(81))}<w:r><w:tab/></w:r>${run('Inkooporder')}</w:p>`,
    `<w:p>${run(S(40))}${run('€ 1,00')}<w:r><w:tab/></w:r>${run('extra')}</w:p>`,
    `<w:p>${run(S(40))}${run('€ 1,00')}${run(S(25))}${run('nog iets')}</w:p>`,
    `<w:p>${run(S(40) + '€ 1,00   nog iets')}</w:p>`,
    `<w:p><w:r><w:sym w:font="Wingdings 2" w:char="F0A3"/></w:r>${run(S(40) + '€ 1,00')}</w:p>`,
    `<w:p>${run(S(40))}<w:r><w:drawing/></w:r>${run('x')}</w:p>`,
    `<w:p>${run(S(40))}<w:fldSimple w:instr="PAGE">${run('4')}</w:fldSimple></w:p>`,
    `<w:p>${run(S(40))}<w:r><w:t>€ 1,00</w:t><w:cr/><w:t>regel 2</w:t></w:r></w:p>`,
    `<w:p>${run(S(40))}<w:r><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/><w:t>€ 1,00</w:t></w:r></w:p>`,
    `<w:p><w:r><w:footnoteReference w:id="2"/></w:r>${run(S(40))}${run('€ 1,00')}</w:p>`,
    `<w:p>${run(S(40))}<w:r><w:commentReference w:id="1"/></w:r>${run('€ 1,00')}</w:p>`,
    `<w:p>${run(S(53))}</w:p>`, // alleen spaties (de lege opvulrij)
    `<w:p>${run(S(40) + 'x'.repeat(61))}</w:p>`,
  ]
  for (const p of gevallen) {
    const r = opvulspatiesNaarRechts(cel(p))
    assert.equal(r.aangepast, 0, p.slice(0, 90))
    assert.equal(r.xml, cel(p))
  }
  const body = `<w:body><w:p>${run(S(40) + '€ 1,00')}</w:p></w:body>`
  assert.deepEqual(opvulspatiesNaarRechts(body), { xml: body, aangepast: 0 })
})

test('celAlineas: geneste tabellen tellen mee, alinea\'s in een tekstvak binnen een cel niet', () => {
  const binnenCel = `<w:p>${run(S(40) + '€ 2,00')}</w:p>`
  const naGenest = `<w:p>${run(S(40) + '€ 3,00')}</w:p>`
  const tekstvak = `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p>${run('kop')}</w:p><w:p>${run(S(40) + '€ 9,99')}</w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice></mc:AlternateContent></w:r></w:p>`
  const xml = `<w:tbl><w:tr><w:tc><w:tbl><w:tr><w:tc>${binnenCel}</w:tc></w:tr></w:tbl>${naGenest}${tekstvak}</w:tc></w:tr></w:tbl><w:p>${run(S(40) + 'body')}</w:p>`
  const alineas = celAlineas(xml).map(({ start, end }) => xml.slice(start, end))
  assert.deepEqual(alineas, [binnenCel, naGenest, tekstvak])
  const r = opvulspatiesNaarRechts(xml)
  assert.equal(r.aangepast, 2, 'de geneste cel en de outer-cel-alinea erna; niet het tekstvak, niet de body')
  assert.ok(r.xml.includes(`<w:pPr><w:jc w:val="right"/></w:pPr>${run('€ 2,00')}`))
  assert.ok(r.xml.includes(`<w:pPr><w:jc w:val="right"/></w:pPr>${run('€ 3,00')}`))
  assert.ok(r.xml.includes(run(S(40) + '€ 9,99')), 'tekstvak-alinea ongemoeid')
  assert.ok(r.xml.endsWith(`<w:p>${run(S(40) + 'body')}</w:p>`))
})
