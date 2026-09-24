// Alinea's in een tekstvak de standaard-alineastijl van het document geven,
// zoals Word dat impliciet doet.
//
// Aanleiding (2026-09-24, offerte "Case 00061587" en "test_nieuwe_opmaak_26"):
// de tekst in de tekstvakken van o.a. "Motrac op maat" kwam als Calibri in de
// PDF, terwijl Word er DaxPro-Light van maakt. Oorzaak: een `<w:p>` zonder
// `<w:pStyle>` valt in Word onder de standaardstijl ("Standaard"/Normal, hier
// DaxPro-Light). LibreOffice geeft zo'n alinea in een tekstvak de eigen stijl
// "Frame contents", en die erft niet van Standaard maar van de docDefaults —
// en daar staat in de Motrac-sjablonen het thema-lettertype (minorHAnsi =
// Calibri). Gecontroleerd met een FODT-export (LO 24.2): vóór deze stap
// `parent-style-name="Frame_20_contents"` + `font-name="Calibri"`, erna
// `parent-style-name="Standard"`.
//
// Een alinea die al een `<w:pStyle>` heeft, blijft ongemoeid. Alinea's buiten
// een tekstvak ook: daar doet LibreOffice het al goed.

const TOKEN = /<w:txbxContent\b[^>]*?(\/?)>|<\/w:txbxContent>|<w:p(?=[\s/>])([^>]*?)(\/?)>(<w:pPr\s*\/>|<w:pPr>(?:<w:pStyle\b)?)?/g

/**
 * Het `w:styleId` van de standaard-alineastijl uit styles.xml, of null.
 * @param {string} [stylesXml]
 */
export function standaardAlineastijl(stylesXml) {
  for (const m of (stylesXml ?? '').matchAll(/<w:style\b([^>]*)>/g)) {
    const attr = m[1]
    if (/\bw:type="paragraph"/.test(attr) && /\bw:default="(?:1|true|on)"/.test(attr)) {
      return attr.match(/\bw:styleId="([^"]+)"/)?.[1] ?? null
    }
  }
  return null
}

/**
 * Zet `<w:pStyle w:val="…"/>` op elke alinea zonder stijl binnen een
 * `<w:txbxContent>` (ook geneste, en ook in de VML-terugval).
 * @param {string} xml document.xml / header*.xml / footer*.xml
 * @param {string|null} stijlId de standaard-alineastijl (standaardAlineastijl())
 * @returns {{ xml: string, aangepast: number }}
 */
export function standaardstijlInTekstvakken(xml, stijlId) {
  if (!stijlId || !xml.includes('<w:txbxContent')) return { xml, aangepast: 0 }
  const pStyle = `<w:pStyle w:val="${stijlId.replace(/[<>&"]/g, '')}"/>`
  let diepte = 0
  let aangepast = 0
  const uit = xml.replace(TOKEN, (tag, txbxLeeg, pAttr, pLeeg, pPr) => {
    if (tag.startsWith('<w:txbxContent')) {
      if (!txbxLeeg) diepte++
      return tag
    }
    if (tag === '</w:txbxContent>') {
      diepte = Math.max(0, diepte - 1)
      return tag
    }
    if (diepte === 0) return tag
    const open = `<w:p${pAttr}>`
    if (pLeeg) {
      aangepast++
      return `${open}<w:pPr>${pStyle}</w:pPr></w:p>`
    }
    if (!pPr) {
      aangepast++
      return `${open}<w:pPr>${pStyle}</w:pPr>`
    }
    if (pPr.endsWith('<w:pStyle')) return tag // heeft al een stijl
    aangepast++
    // `<w:pStyle>` hoort het eerste kind van `<w:pPr>` te zijn (schemavolgorde).
    return `${open}<w:pPr>${pStyle}${pPr.startsWith('<w:pPr>') ? '' : '</w:pPr>'}`
  })
  return { xml: uit, aangepast }
}
