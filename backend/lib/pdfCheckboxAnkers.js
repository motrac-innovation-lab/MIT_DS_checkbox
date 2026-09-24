// De PDF-stap: elk checkbox-glyph in de gerenderde PDF krijgt een verborgen
// DocuSign-anker in de tekstlaag. Port van `PdfCheckboxService.java` uit
// `esign_motrac`, inclusief de daar hard geleerde lessen (zie diens
// claude-overdracht.md §10):
//
//   - Het anker is ECHTE tekst in de pagina-inhoud (geen annotatie, geen
//     formulierveld): DocuSign's anchor-matcher leest de tekstlaag, niets
//     anders. Geen AcroForm — dat bleek een doodlopende weg.
//   - Wit, 1 pt Helvetica, met de rechterrand vlak vóór de linkerrand van het
//     zichtbare vakje, op de basislijn van het glyph. De Apex-kant gebruikt
//     placement 'right' en offset 0,0, zodat de DocuSign-CheckboxTab op het
//     vakje zelf landt.
//   - Het zichtbare ☐ blijft staan — niets afdekken of verwijderen; DocuSign
//     tekent zijn eigen vakje eroverheen.
//   - De teller is globaal over het hele document (\cb_001\, \cb_002\, …),
//     nooit per pagina: Apex loopt door tot er geen match meer is.
//   - Herkend worden ☐ (U+2610) en U+F0A3 (Wingdings 2 F0A3 in de Private Use
//     Area, het vangnet als de voorbewerking een symbool miste). Bewust niet
//     breder: √ staat in de service-inclusies en is geen checkbox, □ wordt
//     door Motrac niet als vakje gebruikt en "[ ]" is te dubbelzinnig.
//
// Posities komen uit pdfjs-dist (tekst-items met hun transformatie in
// PDF-gebruikersruimte, oorsprong linksonder — géén omrekening zoals bij
// PDFBox nodig was); het stempelen doet pdf-lib, dat de tekst in een eigen,
// met q/Q omkaderde inhoudsstroom achter de bestaande zet zodat de rest van
// de pagina en de bestaande ankers (\i1\, \s2\, \n2\, \ref2\) onaangeroerd
// blijven.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib'

const CHECKBOX_SYMBOLEN = new Set(['☐', ''])
const ANKER_LETTERGROOTTE = 1
/** Extra ruimte tussen de rechterrand van het anker en het zichtbare glyph (pt). */
const ANKER_TUSSENRUIMTE = 0.5

export function isCheckboxMarkering(teken) {
  return typeof teken === 'string' && CHECKBOX_SYMBOLEN.has(teken)
}

/** Voor tests en logging: de ankernaam bij volgnummer n (1-gebaseerd). */
export function ankerNaam(n) {
  return `\\cb_${String(n).padStart(3, '0')}\\`
}

/** Opent een PDF met pdf.js met de instellingen van deze app (ook voor lettertypeProbe.js). */
export async function openMetPdfjs(pdfBytes) {
  return getDocument({
    data: pdfBytes.slice(), // pdf.js neemt de buffer over; de aanroeper houdt zijn eigen kopie
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise
}

/**
 * Alle checkbox-glyphs, in leesvolgorde (per pagina van boven naar beneden,
 * van links naar rechts), met hun positie in PDF-gebruikersruimte.
 * @returns {Promise<{ paginaIndex: number, x: number, y: number, breedte: number, hoogte: number, exact: boolean }[]>}
 */
export async function zoekCheckboxPosities(pdfBytes) {
  const doc = await openMetPdfjs(pdfBytes)
  try {
    const alle = []
    for (let p = 1; p <= doc.numPages; p++) {
      const pagina = await doc.getPage(p)
      const { items } = await pagina.getTextContent()
      const opPagina = []
      for (const item of items) {
        if (typeof item.str !== 'string' || !item.str) continue
        const tekens = [...item.str]
        for (let i = 0; i < tekens.length; i++) {
          if (!CHECKBOX_SYMBOLEN.has(tekens[i])) continue
          const [a, , , d, x0, y0] = item.transform
          const lettergrootte = Math.abs(d) || Math.abs(a) || item.height || 0
          // LibreOffice zet het vakje vrijwel altijd in een ander lettertype
          // dan de omringende tekst (DaxPro heeft geen ☐), en pdf.js splitst
          // items op lettertypewissel: het glyph is dan het enige (niet-spatie)
          // teken van zijn item en x0 is exact zijn linkerrand. Staat het
          // tóch midden in een item, dan is de positie een schatting op basis
          // van de gemiddelde tekenbreedte — gelogd als niet-exact.
          const alleen = tekens.filter((t) => t.trim()).length === 1
          const exact = alleen || i === 0
          const x = exact ? x0 : x0 + (item.width * i) / tekens.length
          const breedte = alleen ? item.width : lettergrootte
          opPagina.push({ paginaIndex: p - 1, x, y: y0, breedte: breedte || lettergrootte, hoogte: lettergrootte, exact })
        }
      }
      // Leesvolgorde: pdf.js levert items in de volgorde van de inhoudsstroom,
      // en LibreOffice schrijft een regel niet altijd van links naar rechts weg
      // (het glyph in het afwijkende lettertype komt vaak ná de regeltekst).
      opPagina.sort((k, l) => (Math.abs(l.y - k.y) > 2 ? l.y - k.y : k.x - l.x))
      alle.push(...opPagina)
      pagina.cleanup()
    }
    return alle
  } finally {
    await doc.destroy()
  }
}

/**
 * Plaatst de verborgen ankers en geeft de nieuwe PDF terug.
 * @param {Uint8Array} pdfBytes
 * @param {{ xOffset?: number, yOffset?: number }} [opties] fijnafstelling in pt (standaard 0,0 — zoals in de PoC)
 * @returns {Promise<{ pdf: Uint8Array, aantal: number, ankers: { naam: string, pagina: number, x: number, y: number, exact: boolean }[] }>}
 */
export async function plaatsAnkers(pdfBytes, { xOffset = 0, yOffset = 0 } = {}) {
  const posities = await zoekCheckboxPosities(pdfBytes)
  if (!posities.length) return { pdf: pdfBytes, aantal: 0, ankers: [] }

  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false })
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica)
  const paginas = pdf.getPages()
  const ankers = []

  posities.forEach((positie, index) => {
    const naam = ankerNaam(index + 1)
    const pagina = paginas[positie.paginaIndex]
    const ankerBreedte = helvetica.widthOfTextAtSize(naam, ANKER_LETTERGROOTTE)
    const x = positie.x - ankerBreedte - ANKER_TUSSENRUIMTE + xOffset
    const y = positie.y + yOffset
    pagina.drawText(naam, { x, y, size: ANKER_LETTERGROOTTE, font: helvetica, color: rgb(1, 1, 1) })
    ankers.push({ naam, pagina: positie.paginaIndex + 1, x, y, exact: positie.exact })
  })

  return { pdf: await pdf.save(), aantal: ankers.length, ankers }
}

/**
 * De lettertypen die in de PDF ingebed/gebruikt zijn (BaseFont-namen, zonder
 * subset-voorvoegsel zoals "BAAAAA+"). Alle indirecte objecten worden
 * nagelopen in plaats van de Resources per pagina: LibreOffice deelt
 * lettertype-objecten over pagina's en dit mist er zo geen één.
 */
export async function lettertypenInPdf(pdfBytes) {
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false })
  const namen = new Set()
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type')) !== PDFName.of('Font')) continue
    const baseFont = obj.get(PDFName.of('BaseFont'))
    if (!baseFont) continue
    const naam = typeof baseFont.decodeText === 'function' ? baseFont.decodeText() : String(baseFont)
    namen.add(naam.replace(/^\/?/, '').replace(/^[A-Z]{6}\+/, ''))
  }
  return [...namen].sort()
}

/** Alle tekst uit de PDF (voor tests en diagnose) — de tekstlaag zoals DocuSign hem leest. */
export async function tekstUitPdf(pdfBytes) {
  const doc = await openMetPdfjs(pdfBytes)
  try {
    const regels = []
    for (let p = 1; p <= doc.numPages; p++) {
      const pagina = await doc.getPage(p)
      const { items } = await pagina.getTextContent()
      regels.push(items.map((i) => i.str ?? '').join(''))
      pagina.cleanup()
    }
    return regels.join('\n')
  } finally {
    await doc.destroy()
  }
}
