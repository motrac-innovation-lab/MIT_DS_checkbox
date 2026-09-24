// Vormen die in Word onzichtbaar zijn omdat er een dekkende vorm óverheen
// ligt, vóór de render uit de DOCX halen.
//
// Aanleiding (2026-09-24, offerte "test_nieuwe_opmaak_26"): de
// Oplossingen-pagina van de nieuwe offerte-opmaak ligt als één groep van foto's
// en rode vlakken (hogere `relativeHeight`) precies over een oud technisch
// gegevensblad ("Truck data" / "Warehouse data", 140 losse tekstvakken) heen.
// In Word zie je dat blad dus nooit. LibreOffice houdt die stapelvolgorde bij
// tekstvakken niet aan: de TEKST van een tekstvak achter de tekst komt boven
// alle andere achtergrondvormen te staan, en in de PDF stond de hele tabel
// dwars over de foto's heen. In LO 24.2 en 26.8 allebei, dus geen
// versiekwestie die vanzelf overgaat.
//
// Wat er weg mag, is bewust smal gehouden — liever een vorm te veel laten
// staan dan iets weghalen dat de klant in Word wél ziet:
//   - alleen `wp:anchor`-vormen die aan dezelfde alinea hangen, met positie
//     ten opzichte van de PAGINA in beide richtingen (dan zijn de coördinaten
//     exact en hoeft er niets over de lay-out geraden te worden);
//   - een vorm verdwijnt alleen als élk meetpunt van zijn rechthoek onder een
//     DEKKEND deel valt van een vorm die in Word boven hem ligt;
//   - dekkend is: een JPEG-foto (geen alfakanaal), of een vorm met een
//     effen vulling zonder transparantie, als rechthoek of als pad van
//     rechte lijnen. PNG (kan transparant zijn), rotatie, gespiegelde paden
//     en bogen tellen NIET als dekkend.
// Een ☐ in zo'n verborgen tekstvak verdwijnt mee — terecht: die ziet de klant
// in Word ook niet, en er hoort dan ook geen DocuSign-veld op.

const RASTER = 12 // meetpunten per richting binnen de rechthoek van een vorm

// ---- Minimale XML-lezer -------------------------------------------------------
// Geen parser-dependency: de voorbewerking werkt al op XML-tekst (zie
// docxVoorbewerking.js), en hier zijn alleen elementgrenzen en attributen nodig.

const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
const ATTR = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

function attributen(tekst) {
  const a = {}
  for (const m of tekst.matchAll(ATTR)) a[m[1]] = m[2] ?? m[3]
  return a
}

/** Mini-DOM van een XML-fragment: { naam, attr, kinderen, tekst }. */
function parse(xml) {
  const wortel = { naam: '#wortel', attr: {}, kinderen: [], tekst: '' }
  const stapel = [wortel]
  let vorige = 0
  for (const m of xml.matchAll(TAG)) {
    const top = stapel[stapel.length - 1]
    top.tekst += xml.slice(vorige, m.index)
    vorige = m.index + m[0].length
    if (!m[2]) continue // commentaar, PI, CDATA
    if (m[1]) {
      if (stapel.length > 1) stapel.pop()
      continue
    }
    const knoop = { naam: m[2], attr: attributen(m[3]), kinderen: [], tekst: '' }
    top.kinderen.push(knoop)
    if (!m[4]) stapel.push(knoop)
  }
  return wortel
}

const kind = (k, naam) => k?.kinderen.find((c) => c.naam === naam)
const kinderen = (k, naam) => k?.kinderen.filter((c) => c.naam === naam) ?? []
const getal = (v) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

/**
 * Alle `wp:anchor`-elementen die rechtstreeks aan een alinea hangen (niet
 * genest in een ander anker, niet in een `mc:Fallback`), met hun positie in de
 * tekst en het stuk dat bij verwijderen weg moet.
 */
function vindAnkers(xml) {
  const stapel = []
  const ankers = []
  for (const m of xml.matchAll(TAG)) {
    if (!m[2]) continue
    const naam = m[2]
    if (m[1]) {
      // sluittag: terug naar het bijbehorende open element
      let i = stapel.length - 1
      while (i >= 0 && stapel[i].naam !== naam) i--
      if (i < 0) continue
      const el = stapel[i]
      stapel.length = i
      el.eind = m.index + m[0].length
      if (el.anker) {
        el.anker.eind = el.eind
        ankers.push(el.anker)
      }
      if (el.bereik) el.bereik.eind = el.eind
      continue
    }
    const el = { naam, start: m.index }
    if (!m[4]) stapel.push(el)
    if (naam !== 'wp:anchor') continue

    if (stapel.some((s) => s !== el && (s.naam === 'wp:anchor' || s.naam === 'mc:Fallback'))) continue
    const alinea = [...stapel].reverse().find((s) => s.naam === 'w:p')
    if (!alinea) continue
    // Weg moet de hele `mc:AlternateContent` als het anker in diens
    // `mc:Choice` zit — anders valt LibreOffice terug op de VML-kopie in
    // `mc:Fallback` en staat de vorm er gewoon weer. Zonder AlternateContent
    // is het de `w:drawing`.
    const idx = stapel.length - 1
    const keuze = stapel.findLastIndex((s, j) => j < idx && s.naam === 'mc:Choice')
    const alt = keuze > 0 && stapel[keuze - 1].naam === 'mc:AlternateContent' ? stapel[keuze - 1] : null
    const drawing = stapel.findLast((s, j) => j < idx && s.naam === 'w:drawing')
    const houder = alt ?? drawing
    if (!houder) continue
    const anker = { alinea: alinea.start, start: m.index, bereik: { start: houder.start } }
    el.anker = anker
    houder.bereik = anker.bereik
  }
  return ankers
}

// ---- Geometrie ------------------------------------------------------------------

/** Transformatie van kind- naar paginacoördinaten. */
const identiek = (x, y) => [x, y]

function xfrmVan(spPr) {
  const x = kind(spPr, 'a:xfrm')
  if (!x) return null
  const off = kind(x, 'a:off')
  const ext = kind(x, 'a:ext')
  return {
    rot: getal(x.attr.rot) ?? 0,
    flip: x.attr.flipH === '1' || x.attr.flipV === '1',
    x: getal(off?.attr.x) ?? 0,
    y: getal(off?.attr.y) ?? 0,
    cx: getal(ext?.attr.cx),
    cy: getal(ext?.attr.cy),
    chOff: kind(x, 'a:chOff'),
    chExt: kind(x, 'a:chExt'),
  }
}

function heeftTransparantie(k) {
  if (!k) return false
  if (k.naam === 'a:alpha' || k.naam === 'a:alphaModFix' || k.naam === 'a:alphaMod' || k.naam === 'a:alphaOff') return true
  return k.kinderen.some(heeftTransparantie)
}

function rechthoek(x, y, cx, cy) {
  return [[[x, y], [x + cx, y], [x + cx, y + cy], [x, y + cy]]]
}

/**
 * De dekkende gebieden van één vorm, als lijst van "paden" (elk een lijst
 * polygonen die met even-oneven gevuld wordt), in de coördinaten van `naar`.
 * `vak` = [x, y, cx, cy] van de vorm in de ruimte van zijn ouder.
 */
function dekkendeDelen(knoop, vak, naar, rels) {
  const [vx, vy, vcx, vcy] = vak
  const opPagina = naar

  if (knoop.naam === 'pic:pic') {
    const blip = kind(kind(knoop, 'pic:blipFill'), 'a:blip')
    const doel = rels[blip?.attr['r:embed']] ?? ''
    if (!/\.jpe?g$/i.test(doel) || heeftTransparantie(blip)) return []
    if (xfrmVan(kind(knoop, 'pic:spPr'))?.rot) return []
    const geom = kind(kind(knoop, 'pic:spPr'), 'a:prstGeom')
    if (geom && geom.attr.prst !== 'rect') return []
    return [rechthoek(vx, vy, vcx, vcy).map((poly) => poly.map(([x, y]) => opPagina(x, y)))]
  }

  if (knoop.naam === 'wps:wsp') {
    const spPr = kind(knoop, 'wps:spPr')
    const vulling = kind(spPr, 'a:solidFill')
    if (!vulling || heeftTransparantie(vulling) || xfrmVan(spPr)?.rot) return []
    const prst = kind(spPr, 'a:prstGeom')
    if (prst) {
      if (prst.attr.prst !== 'rect') return []
      return [rechthoek(vx, vy, vcx, vcy).map((poly) => poly.map(([x, y]) => opPagina(x, y)))]
    }
    const cust = kind(spPr, 'a:custGeom')
    if (!cust || xfrmVan(spPr)?.flip) return []
    const paden = []
    for (const pad of kinderen(kind(cust, 'a:pathLst'), 'a:path')) {
      if (pad.attr.fill === 'none') continue
      const pw = getal(pad.attr.w) || vcx
      const ph = getal(pad.attr.h) || vcy
      if (!pw || !ph) return []
      const polys = []
      let huidig = null
      for (const c of pad.kinderen) {
        if (c.naam === 'a:moveTo' || c.naam === 'a:lnTo') {
          const pt = kind(c, 'a:pt')
          const x = vx + (getal(pt?.attr.x) ?? 0) * (vcx / pw)
          const y = vy + (getal(pt?.attr.y) ?? 0) * (vcy / ph)
          if (c.naam === 'a:moveTo' || !huidig) {
            huidig = []
            polys.push(huidig)
          }
          huidig.push(opPagina(x, y))
        } else if (c.naam === 'a:close') {
          huidig = null
        } else {
          return [] // boog/bezier: niet als dekkend meetellen
        }
      }
      if (polys.length) paden.push(polys)
    }
    return paden
  }

  if (knoop.naam === 'wpg:wgp' || knoop.naam === 'wpg:grpSp') {
    const x = xfrmVan(kind(knoop, 'wpg:grpSpPr'))
    const chOffX = getal(x?.chOff?.attr.x) ?? 0
    const chOffY = getal(x?.chOff?.attr.y) ?? 0
    const chCx = getal(x?.chExt?.attr.cx) || vcx
    const chCy = getal(x?.chExt?.attr.cy) || vcy
    if (x && x.rot) return []
    const sx = vcx / chCx
    const sy = vcy / chCy
    const binnen = (cx, cy) => naar(vx + (cx - chOffX) * sx, vy + (cy - chOffY) * sy)
    const delen = []
    for (const c of knoop.kinderen) {
      if (!['pic:pic', 'wps:wsp', 'wpg:grpSp'].includes(c.naam)) continue
      const spPr = kind(c, c.naam === 'pic:pic' ? 'pic:spPr' : c.naam === 'wps:wsp' ? 'wps:spPr' : 'wpg:grpSpPr')
      const cx = xfrmVan(spPr)
      if (!cx || cx.cx == null || cx.cy == null || cx.rot) continue
      delen.push(...dekkendeDelen(c, [cx.x, cx.y, cx.cx, cx.cy], binnen, rels))
    }
    return delen
  }
  return []
}

function inPolygoon(px, py, poly) {
  let binnen = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) binnen = !binnen
  }
  return binnen
}

const inPad = (px, py, polys) => polys.reduce((acc, poly) => (inPolygoon(px, py, poly) ? !acc : acc), false)

// ---- Het anker zelf ----------------------------------------------------------

/** Leest één `wp:anchor`: z-volgorde, rechthoek op de pagina, dekkende delen. */
function leesAnker(fragment, rels) {
  const anker = kind(parse(fragment), 'wp:anchor')
  if (!anker || anker.attr.simplePos === '1') return null
  const h = kind(anker, 'wp:positionH')
  const v = kind(anker, 'wp:positionV')
  const ext = kind(anker, 'wp:extent')
  const x = getal(kind(h, 'wp:posOffset')?.tekst.trim())
  const y = getal(kind(v, 'wp:posOffset')?.tekst.trim())
  const cx = getal(ext?.attr.cx)
  const cy = getal(ext?.attr.cy)
  const opPagina = h?.attr.relativeFrom === 'page' && v?.attr.relativeFrom === 'page'
  if (!opPagina || x == null || y == null || !cx || !cy) return null

  // Voor de tekst ligt altijd boven achter de tekst; daarbinnen telt relativeHeight.
  const z = (anker.attr.behindDoc === '1' ? 0 : 1) * 2 ** 32 + (getal(anker.attr.relativeHeight) ?? 0)
  const data = kind(kind(anker, 'a:graphic'), 'a:graphicData')
  const vorm = data?.kinderen.find((c) => ['pic:pic', 'wps:wsp', 'wpg:wgp'].includes(c.naam))
  const delen = vorm ? dekkendeDelen(vorm, [x, y, cx, cy], identiek, rels) : []
  return { z, x, y, cx, cy, delen, naam: kind(anker, 'wp:docPr')?.attr.name ?? '' }
}

function volledigBedekt(onder, boven) {
  if (!boven.length) return false
  for (let i = 0; i < RASTER; i++) {
    for (let j = 0; j < RASTER; j++) {
      const px = onder.x + ((i + 0.5) / RASTER) * onder.cx
      const py = onder.y + ((j + 0.5) / RASTER) * onder.cy
      if (!boven.some((b) => b.delen.some((pad) => inPad(px, py, pad)))) return false
    }
  }
  return true
}

/**
 * Relaties (`Id` → `Target`) uit het .rels-bestand van een onderdeel.
 * @param {string} [relsXml]
 */
export function leesRelaties(relsXml) {
  const rels = {}
  for (const m of (relsXml ?? '').matchAll(/<Relationship\b([^>]*)>/g)) {
    const a = attributen(m[1])
    if (a.Id) rels[a.Id] = a.Target ?? ''
  }
  return rels
}

/**
 * Haalt de vormen weg die in Word volledig onder een dekkende vorm liggen.
 * @param {string} xml document.xml / header*.xml / footer*.xml
 * @param {Record<string,string>} rels `leesRelaties()` van het bijbehorende .rels-bestand
 * @returns {{ xml: string, verwijderd: number }}
 */
export function verwijderBedekteVormen(xml, rels = {}) {
  if (!xml.includes('<wp:anchor')) return { xml, verwijderd: 0 }
  const perAlinea = new Map()
  for (const a of vindAnkers(xml)) {
    if (a.eind === undefined || a.bereik.eind === undefined) continue
    const gelezen = leesAnker(xml.slice(a.start, a.eind), rels)
    if (!gelezen) continue
    const lijst = perAlinea.get(a.alinea) ?? []
    lijst.push({ ...gelezen, bereik: a.bereik })
    perAlinea.set(a.alinea, lijst)
  }

  const weg = []
  for (const vormen of perAlinea.values()) {
    if (vormen.length < 2) continue
    for (const v of vormen) {
      const boven = vormen.filter((b) => b !== v && b.z > v.z && b.delen.length)
      if (volledigBedekt(v, boven)) weg.push(v.bereik)
    }
  }
  if (!weg.length) return { xml, verwijderd: 0 }

  weg.sort((a, b) => b.start - a.start)
  let uit = xml
  for (const b of weg) uit = uit.slice(0, b.start) + uit.slice(b.eind)
  return { xml: uit, verwijderd: weg.length }
}
