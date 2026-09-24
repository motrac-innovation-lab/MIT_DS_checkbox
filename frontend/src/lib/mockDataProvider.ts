// Nepdatalaag voor UI-werk zonder backend/LibreOffice: VITE_DATA_BACKEND=mock
// in frontend/.env. Geeft na een korte vertraging plausibele antwoorden terug,
// inclusief een piepklein maar geldig PDF'je zodat de downloadknop echt iets
// doet. Alleen de UI-paden testen, nooit als "het werkt"-bewijs gebruiken.
import type { DataProvider } from './dataProvider'
import type { BeeldbankAntwoord, BeeldbankItem, BeeldbankLijst, BeeldbankUpload, BeeldbankVergelijking, ConversieRegel, ConversieResultaat, ConversieStatus, MeegestuurdeAfbeelding, Pagina } from '../types'

const MINI_PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'

const wacht = (ms: number) => new Promise<void>((klaar) => setTimeout(klaar, ms))

const REGELS: ConversieRegel[] = Array.from({ length: 23 }, (_, i) => ({
  id: 23 - i,
  aangemaaktOp: new Date(Date.now() - i * 3_600_000 * 5).toISOString(),
  actorNaam: i % 3 === 0 ? 'Mark Kuijpers' : 'Sales Collega',
  actorEmail: i % 3 === 0 ? 'mark.kuijpers@motrac.nl' : 'sales@motrac.nl',
  bestandsnaam: `Offerte ${2026_000 + i}.docx`,
  status: i === 4 ? 'mislukt' : 'geslaagd',
  aantalCheckboxen: i === 4 ? null : 6 + (i % 4) * 6,
  duurMs: i === 4 ? 812 : 2400 + i * 37,
  engine: 'soffice',
  lettertypenVervangen: i === 7 ? ['DaxPro-Medium'] : [],
  foutcode: i === 4 ? 'CONVERSIE_MISLUKT' : null,
  foutmelding: i === 4 ? 'Het document kon niet naar PDF worden omgezet.' : null,
}))

// Een beeldbank in het geheugen, zodat de beheerpagina zonder backend werkt.
const BEELDEN = new Map<string, BeeldbankItem>(Array.from({ length: 37 }, (_, i) => {
  const naam = `${1254 + i}_00_E${20 + (i % 6) * 5}-600_BASIC_WEB_0002.png`
  return [naam.toLowerCase(), { naam, grootte: 180_000 + i * 12_345, gewijzigdOp: new Date(Date.now() - i * 86_400_000).toISOString(), submap: null, alleenLezen: false }]
}))

export class MockDataProvider implements DataProvider {
  async conversieStatus(): Promise<ConversieStatus> {
    await wacht(300)
    return {
      engine: 'soffice',
      beschikbaar: true,
      libreoffice: { versie: '24.2.7.2 (mock)' },
      lettertypen: {
        vereist: ['DaxPro', 'DaxPro-Bold', 'DaxPro-Light', 'DaxPro-Medium'],
        ontbreekt: ['DaxPro-Medium'],
        bestanden: [
          { bestand: 'DejaVuSans.ttf', families: ['DejaVu Sans'] },
          { bestand: 'DaxPro.otf', families: ['DaxPro'] },
          { bestand: 'DaxPro-Light.otf', families: ['DaxPro Light'] },
        ],
        viaFontmappen: true,
      },
      maxDocxBytes: 25 * 1024 * 1024,
    }
  }

  // De mock-beeldbank is leeg, zodat de map-kiezer op de conversiepagina
  // zonder backend te bekijken is.
  async beeldbank(namen: string[]): Promise<BeeldbankAntwoord> {
    await wacht(200)
    return { gevonden: [], ontbrekend: namen }
  }

  async converteer(bestandsnaam: string, _docxBase64?: string, afbeeldingen: MeegestuurdeAfbeelding[] = []): Promise<ConversieResultaat> {
    await wacht(1500)
    return {
      bestandsnaam: bestandsnaam.replace(/\.docx$/i, '') + '.pdf',
      aantalCheckboxen: 12,
      pdfBase64: btoa(MINI_PDF),
      lettertypen: { gevraagd: ['DaxPro', 'DaxPro-Light', 'DaxPro-Medium'], inPdf: ['DaxPro', 'DaxPro-Light', 'DejaVuSans'], vervangen: ['DaxPro-Medium'] },
      engine: 'soffice',
      duurMs: 1487,
      symbolenVervangen: 12,
      ankersGeschat: 0,
      ontbrekendeAfbeeldingen: [],
      afbeeldingenIngesloten: afbeeldingen.length,
      lettertypenOmgezet: {},
    }
  }

  async conversies(page: number, pageSize: number): Promise<Pagina<ConversieRegel>> {
    await wacht(250)
    const begin = (page - 1) * pageSize
    return { items: REGELS.slice(begin, begin + pageSize), page, pageSize, totaal: REGELS.length }
  }

  async beeldbankLijst(zoek: string, page: number, pageSize: number): Promise<BeeldbankLijst> {
    await wacht(200)
    const alle = [...BEELDEN.values()]
      .filter((b) => !zoek || b.naam.toLowerCase().includes(zoek.toLowerCase()))
      .sort((a, b) => a.naam.localeCompare(b.naam))
    const begin = (page - 1) * pageSize
    return { items: alle.slice(begin, begin + pageSize), page, pageSize, totaal: alle.length, opslag: { map: '/uploads/afbeeldingen', bestaat: true, kanAanmaken: true } }
  }

  async beeldbankVergelijk(bestanden: { bestandsnaam: string, grootte: number }[]): Promise<BeeldbankVergelijking> {
    await wacht(150)
    const uit: BeeldbankVergelijking = { nieuw: [], gewijzigd: [], gelijk: [] }
    for (const { bestandsnaam, grootte } of bestanden) {
      const b = BEELDEN.get(bestandsnaam.toLowerCase())
      ;(!b ? uit.nieuw : b.grootte === grootte ? uit.gelijk : uit.gewijzigd).push(bestandsnaam)
    }
    return uit
  }

  async beeldbankUpload(bestanden: MeegestuurdeAfbeelding[]): Promise<BeeldbankUpload> {
    await wacht(400)
    const opgeslagen = bestanden.map(({ bestandsnaam, base64 }) => {
      const vervangen = BEELDEN.has(bestandsnaam.toLowerCase())
      BEELDEN.set(bestandsnaam.toLowerCase(), { naam: bestandsnaam, grootte: Math.floor((base64.length * 3) / 4), gewijzigdOp: new Date().toISOString(), submap: null, alleenLezen: false })
      return { naam: bestandsnaam, vervangen }
    })
    return { opgeslagen, geweigerd: [] }
  }

  async beeldbankVerwijder(naam: string): Promise<void> {
    await wacht(200)
    BEELDEN.delete(naam.toLowerCase())
  }
}
