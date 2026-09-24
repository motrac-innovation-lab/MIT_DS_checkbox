// Vormen die in Word onder een dekkende vorm liggen, verdwijnen vóór de render
// (zie lib/verborgenVormen.js). Aanleiding: een oud technisch gegevensblad
// onder de Oplossingen-pagina dat LibreOffice er bovenop tekende. Pure
// logica — geen database, geen LibreOffice.
import assert from 'node:assert/strict'
import test from 'node:test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { leesRelaties, verwijderBedekteVormen } from '../lib/verborgenVormen.js'
import { voorbewerkDocx } from '../lib/docxVoorbewerking.js'

const RELS = { rIdJpg: 'media/foto.jpeg', rIdPng: 'media/icoon.png' }

function anker({ naam, x, y, cx, cy, z, achter = true, h = 'page', v = 'page', inhoud }) {
  return '<wp:anchor simplePos="0" relativeHeight="' + z + '" behindDoc="' + (achter ? 1 : 0) + '" locked="0" layoutInCell="1" allowOverlap="1">'
    + '<wp:simplePos x="0" y="0"/>'
    + `<wp:positionH relativeFrom="${h}"><wp:posOffset>${x}</wp:posOffset></wp:positionH>`
    + `<wp:positionV relativeFrom="${v}"><wp:posOffset>${y}</wp:posOffset></wp:positionV>`
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:wrapNone/><wp:docPr id="1" name="${naam}"/>`
    + `<a:graphic><a:graphicData>${inhoud}</a:graphicData></a:graphic></wp:anchor>`
}

/** Zoals Word een tekstvak schrijft: DrawingML in mc:Choice, VML in mc:Fallback. */
function tekstvak(opties, tekst) {
  const inhoud = '<wps:wsp><wps:spPr><a:prstGeom prst="rect"/></wps:spPr>'
    + `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${tekst}</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>`
  return '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>'
    + anker({ ...opties, inhoud })
    + `</w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><w:txbxContent><w:p><w:r><w:t>${tekst}</w:t></w:r></w:p></w:txbxContent></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`
}

function foto(opties, rId = 'rIdJpg') {
  const inhoud = `<pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill><pic:spPr><a:prstGeom prst="rect"/></pic:spPr></pic:pic>`
  return `<w:r><w:drawing>${anker({ ...opties, inhoud })}</w:drawing></w:r>`
}

function vlak(opties, vulling = '<a:solidFill><a:srgbClr val="B7081C"/></a:solidFill>') {
  return `<w:r><w:drawing>${anker({ ...opties, inhoud: `<wps:wsp><wps:spPr><a:prstGeom prst="rect"/>${vulling}</wps:spPr></wps:wsp>` })}</w:drawing></w:r>`
}

const alinea = (...runs) => `<w:body><w:p>${runs.join('')}</w:p><w:p><w:r><w:t>daarna</w:t></w:r></w:p></w:body>`
const ONDER = { naam: 'Tabel', x: 1000, y: 1000, cx: 2000, cy: 500, z: 100 }

test('tekstvak volledig onder een JPEG-foto met hogere z verdwijnt, inclusief de VML-terugval', () => {
  const xml = alinea(tekstvak(ONDER, 'Warehouse data'), foto({ naam: 'Foto', x: 0, y: 0, cx: 5000, cy: 5000, z: 200 }))
  const r = verwijderBedekteVormen(xml, RELS)
  assert.equal(r.verwijderd, 1)
  assert.ok(!r.xml.includes('Warehouse data'), 'ook de mc:Fallback-kopie moet weg')
  assert.ok(!r.xml.includes('mc:AlternateContent'))
  assert.ok(r.xml.includes('name="Foto"'))
  assert.ok(r.xml.includes('daarna'))
})

test('een effen gevuld vlak dekt ook af', () => {
  const r = verwijderBedekteVormen(alinea(tekstvak(ONDER, 'weg'), vlak({ naam: 'Rood', x: 0, y: 0, cx: 5000, cy: 5000, z: 200 })), RELS)
  assert.equal(r.verwijderd, 1)
})

test('blijft staan als de bovenste vorm maar deels dekt', () => {
  const xml = alinea(tekstvak(ONDER, 'blijft'), foto({ naam: 'Foto', x: 0, y: 0, cx: 2500, cy: 5000, z: 200 }))
  assert.equal(verwijderBedekteVormen(xml, RELS).verwijderd, 0)
})

test('twee vormen die samen dekken, tellen samen', () => {
  const xml = alinea(
    tekstvak(ONDER, 'weg'),
    foto({ naam: 'Links', x: 0, y: 0, cx: 2000, cy: 5000, z: 200 }),
    vlak({ naam: 'Rechts', x: 2000, y: 0, cx: 3000, cy: 5000, z: 201 }),
  )
  assert.equal(verwijderBedekteVormen(xml, RELS).verwijderd, 1)
})

test('blijft staan als hij zelf bovenop ligt (hogere relativeHeight of vóór de tekst)', () => {
  const hoger = alinea(tekstvak({ ...ONDER, z: 300 }, 'blijft'), foto({ naam: 'Foto', x: 0, y: 0, cx: 5000, cy: 5000, z: 200 }))
  assert.equal(verwijderBedekteVormen(hoger, RELS).verwijderd, 0)
  const voorDeTekst = alinea(tekstvak({ ...ONDER, z: 1, achter: false }, 'blijft'), foto({ naam: 'Foto', x: 0, y: 0, cx: 5000, cy: 5000, z: 200 }))
  assert.equal(verwijderBedekteVormen(voorDeTekst, RELS).verwijderd, 0)
})

test('PNG, transparante vulling of geen vulling dekken niet af', () => {
  const groot = { naam: 'Boven', x: 0, y: 0, cx: 5000, cy: 5000, z: 200 }
  assert.equal(verwijderBedekteVormen(alinea(tekstvak(ONDER, 'x'), foto(groot, 'rIdPng')), RELS).verwijderd, 0)
  const halfDoorzichtig = '<a:solidFill><a:srgbClr val="B7081C"><a:alpha val="50000"/></a:srgbClr></a:solidFill>'
  assert.equal(verwijderBedekteVormen(alinea(tekstvak(ONDER, 'x'), vlak(groot, halfDoorzichtig)), RELS).verwijderd, 0)
  assert.equal(verwijderBedekteVormen(alinea(tekstvak(ONDER, 'x'), vlak(groot, '<a:noFill/>')), RELS).verwijderd, 0)
})

test('alleen binnen dezelfde alinea en alleen met positie ten opzichte van de pagina', () => {
  const groot = { naam: 'Foto', x: 0, y: 0, cx: 5000, cy: 5000, z: 200 }
  const andereAlinea = `<w:body><w:p>${tekstvak(ONDER, 'x')}</w:p><w:p>${foto(groot)}</w:p></w:body>`
  assert.equal(verwijderBedekteVormen(andereAlinea, RELS).verwijderd, 0)
  const tovAlinea = alinea(tekstvak({ ...ONDER, v: 'paragraph' }, 'x'), foto(groot))
  assert.equal(verwijderBedekteVormen(tovAlinea, RELS).verwijderd, 0)
})

test('groep: kinderen worden via chOff/chExt geschaald, een pad met gat dekt het gat niet', () => {
  // Groep 4000x4000 op de pagina, kindruimte 400x400: een pad dat de hele
  // groep vult op een gat van 100..300 na (even-oneven).
  const pad = (punten) => `<a:moveTo><a:pt x="${punten[0][0]}" y="${punten[0][1]}"/></a:moveTo>`
    + punten.slice(1).map(([x, y]) => `<a:lnTo><a:pt x="${x}" y="${y}"/></a:lnTo>`).join('') + '<a:close/>'
  const groep = (gat) => '<wpg:wgp><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000" cy="4000"/><a:chOff x="0" y="0"/><a:chExt cx="400" cy="400"/></a:xfrm></wpg:grpSpPr>'
    + '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="400" cy="400"/></a:xfrm><a:custGeom><a:pathLst><a:path w="400" h="400">'
    + pad([[0, 0], [400, 0], [400, 400], [0, 400]])
    + (gat ? pad([[100, 100], [300, 100], [300, 300], [100, 300]]) : '')
    + '</a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="B7081C"/></a:solidFill></wps:spPr></wps:wsp></wpg:wgp>'
  const inGat = { naam: 'Tekst', x: 1500, y: 1500, cx: 1000, cy: 1000, z: 100 }
  const metGroep = (gat) => alinea(tekstvak(inGat, 'x'), `<w:r><w:drawing>${anker({ naam: 'Groep', x: 0, y: 0, cx: 4000, cy: 4000, z: 200, inhoud: groep(gat) })}</w:drawing></w:r>`)
  assert.equal(verwijderBedekteVormen(metGroep(false), RELS).verwijderd, 1)
  assert.equal(verwijderBedekteVormen(metGroep(true), RELS).verwijderd, 0)
})

test('document zonder vormen komt ongewijzigd terug', () => {
  const xml = '<w:body><w:p><w:r><w:t>tekst</w:t></w:r></w:p></w:body>'
  assert.deepEqual(verwijderBedekteVormen(xml, RELS), { xml, verwijderd: 0 })
})

test('leesRelaties leest Id → Target', () => {
  const rels = leesRelaties('<Relationships><Relationship Id="rId7" Type="x" Target="media/image7.jpeg"/></Relationships>')
  assert.deepEqual(rels, { rId7: 'media/image7.jpeg' })
})

test('voorbewerkDocx gebruikt de relaties van het onderdeel en telt de verwijderde vormen', () => {
  const docx = zipSync({
    'word/document.xml': strToU8(alinea(tekstvak(ONDER, 'Warehouse data'), foto({ naam: 'Foto', x: 0, y: 0, cx: 5000, cy: 5000, z: 200 }, 'rId9'))),
    'word/_rels/document.xml.rels': strToU8('<Relationships><Relationship Id="rId9" Target="media/foto.jpg"/></Relationships>'),
  })
  const r = voorbewerkDocx(docx)
  assert.equal(r.vormenVerwijderd, 1)
  assert.ok(!strFromU8(unzipSync(r.docx)['word/document.xml']).includes('Warehouse data'))
})
