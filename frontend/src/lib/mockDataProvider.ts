// Nepdatalaag voor UI-werk zonder backend/LibreOffice: VITE_DATA_BACKEND=mock
// in frontend/.env. Geeft na een korte vertraging plausibele antwoorden terug,
// inclusief een piepklein maar geldig PDF'je zodat de downloadknop echt iets
// doet. Alleen de UI-paden testen, nooit als "het werkt"-bewijs gebruiken.
import type { DataProvider } from './dataProvider'
import type { ConversieRegel, ConversieResultaat, ConversieStatus, Pagina } from '../types'

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

export class MockDataProvider implements DataProvider {
  async conversieStatus(): Promise<ConversieStatus> {
    await wacht(300)
    return {
      engine: 'soffice',
      beschikbaar: true,
      libreoffice: { versie: '24.2.7.2 (mock)' },
      lettertypen: {
        vereist: ['DaxPro', 'DaxPro-Light', 'DaxPro-Medium'],
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

  async converteer(bestandsnaam: string): Promise<ConversieResultaat> {
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
    }
  }

  async conversies(page: number, pageSize: number): Promise<Pagina<ConversieRegel>> {
    await wacht(250)
    const begin = (page - 1) * pageSize
    return { items: REGELS.slice(begin, begin + pageSize), page, pageSize, totaal: REGELS.length }
  }
}
