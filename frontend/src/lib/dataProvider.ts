// Het contract tussen de UI en de datalaag — het patroon van mit-salessupport
// (zie CLAUDE.md, "Volgende stap"). Twee implementaties: ApiDataProvider op
// lib/api.ts (de echte backend) en MockDataProvider voor UI-werk zonder
// backend (VITE_DATA_BACKEND=mock). Pagina's praten alleen met dit interface,
// nooit rechtstreeks met fetch() of request().
import type { ConversieRegel, ConversieResultaat, ConversieStatus, Pagina } from '../types'

export interface DataProvider {
  /** Kan de server renderen, en welke lettertypen heeft hij? Voor de statuskaart. */
  conversieStatus(): Promise<ConversieStatus>
  /** Zet één .docx om; `docxBase64` is de ruwe inhoud van het bestand. */
  converteer(bestandsnaam: string, docxBase64: string): Promise<ConversieResultaat>
  /** Het conversies-logboek (beheerder), server-side gepagineerd. */
  conversies(page: number, pageSize: number): Promise<Pagina<ConversieRegel>>
}
