// Opvulspaties in een tabelcel vervangen door rechts uitlijnen.
//
// Aanleiding (2026-09-24, "test_nieuwe_opmaak_26", pagina 4): de rij "Netto
// prijs per truck" zet het bedrag rechts in de cel door er 143 spaties vóór te
// typen: [tab][114 spaties][29 spaties]"€ 86.519,99", vet, uitgevuld. Met de
// glyph-breedtes van de DaxPro-Light in de PDF is dat 143 × 2,52 + 42,4 =
// 402,8 pt, terwijl de cel 386,1 pt tekstruimte heeft (7938 twips minus twee
// celmarges van 108). LibreOffice breekt dus af: het "€" blijft op regel 1 en
// "86.519,99" springt naar regel 2. Of het in Word wél past hangt van
// tienden van punten af (de exacte spatiebreedte van het geïnstalleerde
// lettertype, vet of niet) — opvulspaties zijn per definitie een kwetsbare
// manier om iets rechts te zetten.
//
// Wat de auteur BEDOELT is duidelijk: de tekst tegen de rechterrand van de
// cel. Dat doet deze stap expliciet: in een tabelcel-alinea die uit niets
// anders bestaat dan witruimte (spaties, tabs), een reeks van ≥ OPVUL_MINIMUM
// spaties en daarna één korte tekst, verdwijnen die witruimte-runs en wordt de
// alinea rechts uitgelijnd (`<w:jc w:val="right"/>`). De tekst komt dan op
// dezelfde regel, tegen de celrand — hooguit enkele punten rechts van waar
// Word hem met de spaties zou zetten.
//
// Bewust smal:
//   - alleen alinea's die rechtstreeks in een tabelcel staan (ook in een
//     geneste tabel), niet in een tekstvak in die cel: daar bepaalt het
//     tekstvak de breedte, niet de cel;
//   - vóór de spaties alleen witruimte; de runs die weggaan bevatten niets
//     anders dan witruimte (geen voetnoot-, eindnoot- of opmerkingsverwijzing);
//   - erna één tekst van hoogstens MAX_TEKST tekens, zonder tab en zonder een
//     tweede gat van ≥ 3 spaties (dan zijn het twee kolommen, geen opvulling),
//     ook als Word die tekst over meerdere runs verdeelde ("€ " + "86.519,99");
//     een hyperlink eromheen mag ("download brochure [PDF]", pagina 3);
//   - niets in de alinea dat zelf lay-out maakt: tekening, symbool, veld,
//     regeleinde (br/cr), positietab, inhoudsbesturingselement, wijzigingen.
// "Ondertekening: … Inkooporder" (pagina 11) blijft zo ongemoeid: tekst vóór
// de spaties.

export const OPVUL_MINIMUM = 20
const MAX_TEKST = 60

const COMPLEX = /<w:(?:drawing|sym|pict|object|fldSimple|fldChar|instrText|sdt|br|cr|ptab|noBreakHyphen|softHyphen|ins|del|moveFrom|moveTo|txbxContent|footnoteReference|endnoteReference|commentReference|ruby)\b|<mc:AlternateContent|<m:oMath/
const TOKEN = /<w:tc\b[^>]*?(\/?)>|<\/w:tc>|<w:p\b(?:\s[^>]*?)?(\/?)>|<\/w:p>|<w:txbxContent\b[^>]*?(\/?)>|<\/w:txbxContent>/g
const RUN = /<w:r\b(?:\s[^>]*?)?>[\s\S]*?<\/w:r>/g
const PATROON = new RegExp(`^[\\t ]*? {${OPVUL_MINIMUM},}(\\S[^\\t]{0,${MAX_TEKST - 1}})$`)

/**
 * De alinea's die rechtstreeks in een tabelcel staan (niet in een tekstvak),
 * als [begin, einde) in de XML-tekst. Nesting-bewust: geneste tabellen tellen
 * mee, alinea's in een tekstvak binnen een celalinea niet.
 * @returns {{ start: number, end: number }[]}
 */
export function celAlineas(xml) {
  const uit = []
  let tc = 0
  let tekstvak = 0
  const open = [] // geopende alinea's: { start, kandidaat }
  for (const m of xml.matchAll(TOKEN)) {
    const t = m[0]
    if (t.startsWith('<w:tc')) { if (!m[1]) tc++ }
    else if (t === '</w:tc>') tc = Math.max(0, tc - 1)
    else if (t.startsWith('<w:txbxContent')) { if (!m[3]) tekstvak++ }
    else if (t === '</w:txbxContent>') tekstvak = Math.max(0, tekstvak - 1)
    else if (t.startsWith('<w:p')) { if (!m[2]) open.push({ start: m.index, kandidaat: tc > 0 && tekstvak === 0 && open.length === 0 }) }
    else if (t === '</w:p>') { const p = open.pop(); if (p?.kandidaat) uit.push({ start: p.start, end: m.index + t.length }) }
  }
  return uit
}

/** Einde (exclusief) van het `<w:pPr>`-blok dat op positie 0 van `s` begint, mét geneste pPr in pPrChange. */
function eindeVanPpr(s) {
  let diepte = 0
  for (const m of s.matchAll(/<w:pPr\b[^>]*?(\/?)>|<\/w:pPr>/g)) {
    if (m[0] === '</w:pPr>') { diepte--; if (diepte === 0) return m.index + m[0].length }
    else if (!m[1]) diepte++
    else if (diepte === 0) return m.index + m[0].length
  }
  return -1
}

/** Tekst van een run: w:t → tekst, w:tab → \t; `rest` = alles wat geen opmaak, tekst of tab is. */
function leesRun(run) {
  const binnen = run.replace(/^<w:r\b[^>]*>/, '').replace(/<\/w:r>$/, '').replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, '')
  let tekst = ''
  const rest = binnen.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>|<w:tab\s*\/>|<w:lastRenderedPageBreak\s*\/>/g, (m, t) => {
    if (m.startsWith('<w:tab')) tekst += '\t'
    else if (t) tekst += t
    return ''
  })
  return { tekst, rest: rest.trim() }
}

/** De eerste tekstrun ontdaan van voorafgaande tabs en spaties. */
function zonderVoorloop(run) {
  let klaar = false
  return run.replace(/<w:tab\s*\/>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>/g, (m, t) => {
    if (klaar) return m
    if (m.startsWith('<w:tab') || t === undefined || !t.trim()) return '' // tab of witruimte-w:t vóór de tekst
    klaar = true
    return m.replace(/(<w:t(?:\s[^>]*)?>)[\t ]+/, '$1')
  })
}

/** `<w:jc w:val="right"/>` in de pPr, op de plek die het schema voorschrijft. */
function zetRechts(pPr) {
  const jc = '<w:jc w:val="right"/>'
  if (!pPr) return `<w:pPr>${jc}</w:pPr>`
  if (/^<w:pPr\b[^>]*\/>$/.test(pPr)) return `<w:pPr>${jc}</w:pPr>`
  // pPrChange (wijzigingen bijhouden) bevat een eigen, oude pPr — die hoort
  // ongemoeid te blijven en staat als laatste kind; even apart houden.
  const wijziging = pPr.match(/<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/)?.[0] ?? ''
  let kern = wijziging ? pPr.replace(wijziging, '') : pPr
  if (/<w:jc\b/.test(kern)) kern = kern.replace(/<w:jc\b[^>]*\/>/, jc)
  else {
    const na = kern.match(/<w:(?:textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr)\b/)
    kern = na ? kern.slice(0, na.index) + jc + kern.slice(na.index) : kern.replace(/<\/w:pPr>$/, `${jc}</w:pPr>`)
  }
  return kern.replace(/<\/w:pPr>$/, `${wijziging}</w:pPr>`)
}

/** Eén celalinea; null als hij niet in aanmerking komt. */
function transformeer(p) {
  const openEinde = p.indexOf('>') + 1
  const open = p.slice(0, openEinde)
  let body = p.slice(openEinde, p.length - '</w:p>'.length)
  let pPr = ''
  if (body.startsWith('<w:pPr')) {
    const einde = eindeVanPpr(body)
    if (einde < 0) return null
    pPr = body.slice(0, einde)
    body = body.slice(einde)
  }
  if (COMPLEX.test(body)) return null

  const runs = [...body.matchAll(RUN)].map((m) => ({ xml: m[0], index: m.index, ...leesRun(m[0]) }))
  if (!runs.length || runs.some((r) => r.rest)) return null
  const volledig = runs.map((r) => r.tekst).join('')
  const m = volledig.match(PATROON)
  if (!m || !m[1].trim() || / {3}/.test(m[1])) return null

  const eerste = runs.findIndex((r) => r.tekst.trim())
  if (eerste < 0 || runs.slice(0, eerste).some((r) => /[^\t ]/.test(r.tekst))) return null

  // Van achter naar voren vervangen, zodat de indexen geldig blijven.
  let nieuw = body
  for (let i = eerste; i >= 0; i--) {
    const r = runs[i]
    const vervanging = i === eerste ? zonderVoorloop(r.xml) : ''
    nieuw = nieuw.slice(0, r.index) + vervanging + nieuw.slice(r.index + r.xml.length)
  }
  return `${open}${zetRechts(pPr)}${nieuw}</w:p>`
}

/**
 * Zet in de tabelcellen van een onderdeel elke "opvulspaties + één tekst"-alinea
 * om naar een rechts uitgelijnde alinea zonder die spaties.
 * @param {string} xml document.xml / header*.xml / footer*.xml
 * @returns {{ xml: string, aangepast: number }}
 */
export function opvulspatiesNaarRechts(xml) {
  if (!xml.includes('<w:tc')) return { xml, aangepast: 0 }
  let aangepast = 0
  let uit = xml
  // Van achter naar voren, zodat eerdere posities niet verschuiven.
  for (const { start, end } of celAlineas(xml).reverse()) {
    const p = xml.slice(start, end)
    if (!/ {20}/.test(p)) continue
    const nieuw = transformeer(p)
    if (nieuw === null || nieuw === p) continue
    uit = uit.slice(0, start) + nieuw + uit.slice(end)
    aangepast++
  }
  return { xml: uit, aangepast }
}
