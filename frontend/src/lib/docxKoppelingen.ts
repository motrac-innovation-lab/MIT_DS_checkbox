// Welke afbeeldingen een .docx alleen KOPPELT (niet insluit) — in de browser
// uitgelezen, vóór de upload. De configurator zet de truckfoto als koppeling
// naar de netwerkschijf in de offerte (`file:///E:\…\AFBEELDINGEN CPQ\<naam>.png`);
// de server kan daar niet bij. Weet de app welke namen het zijn, dan kan hij
// de beeldbank op de server raadplegen en de gebruiker zo nodig om de map vragen
// (zie afbeeldingenMap.ts en backend/lib/gekoppeldeAfbeeldingen.js — dezelfde
// regels: externe beeldrelatie, geen webadres, alleen de bestandsnaam).
//
// Geen zip-bibliotheek: alleen de centrale directory en de paar kleine
// `word/_rels/*.rels`-bestanden worden gelezen, uitgepakt met de ingebouwde
// DecompressionStream('deflate-raw').

const BEELD_EXTENSIES = /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg)$/i
const RELS = /^word\/_rels\/[^/]+\.rels$/

/** De bestandsnaam uit een gekoppeld doel, of null als het geen beeldbestand is. */
export function bestandsnaamUitDoel(doel: string): string | null {
  let tekst = doel
  try {
    tekst = decodeURIComponent(doel)
  } catch {
    // ongeldige %-reeks: dan de ruwe tekst
  }
  const naam = (tekst.replace(/\\/g, '/').split('/').pop() ?? '').split(/[?#]/)[0].trim()
  return naam && BEELD_EXTENSIES.test(naam) ? naam : null
}

/** Gekoppelde beeldnamen uit de tekst van één .rels-bestand. */
export function gekoppeldeNamenUitRels(rels: string): string[] {
  const namen: string[] = []
  for (const m of rels.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
    const tag = m[0]
    if (!/\bTargetMode="External"/.test(tag) || !/\bType="[^"]*\/relationships\/image"/.test(tag)) continue
    const doel = (tag.match(/\bTarget="([^"]*)"/)?.[1] ?? '').replace(/&amp;/g, '&')
    if (/^https?:/i.test(doel)) continue
    const naam = bestandsnaamUitDoel(doel)
    if (naam) namen.push(naam)
  }
  return namen
}

async function pakUit(data: Blob, methode: number): Promise<string> {
  if (methode === 0) return data.text()
  if (methode !== 8) throw new Error(`zip-methode ${methode}`)
  return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
}

/**
 * De gekoppelde afbeeldingen van een .docx, zonder dubbelen. Een bestand dat
 * geen leesbare zip is geeft een lege lijst: de backend meldt dat bij de
 * conversie zelf netjes.
 */
export async function gekoppeldeAfbeeldingen(bestand: Blob): Promise<string[]> {
  try {
    const buf = new Uint8Array(await bestand.arrayBuffer())
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    // End of central directory: signatuur 0x06054b50, in de laatste 64 kB + 22.
    let eocd = -1
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) return []
    const aantal = dv.getUint16(eocd + 10, true)
    let p = dv.getUint32(eocd + 16, true)
    const namen = new Set<string>()
    for (let n = 0; n < aantal && p + 46 <= buf.length; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break
      const methode = dv.getUint16(p + 10, true)
      const grootte = dv.getUint32(p + 20, true)
      const naamLengte = dv.getUint16(p + 28, true)
      const extraLengte = dv.getUint16(p + 30, true)
      const commentaarLengte = dv.getUint16(p + 32, true)
      const lokaal = dv.getUint32(p + 42, true)
      const naam = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + naamLengte))
      p += 46 + naamLengte + extraLengte + commentaarLengte
      if (!RELS.test(naam) || dv.getUint32(lokaal, true) !== 0x04034b50) continue
      const begin = lokaal + 30 + dv.getUint16(lokaal + 26, true) + dv.getUint16(lokaal + 28, true)
      for (const g of gekoppeldeNamenUitRels(await pakUit(bestand.slice(begin, begin + grootte), methode))) namen.add(g)
    }
    return [...namen]
  } catch {
    return []
  }
}
