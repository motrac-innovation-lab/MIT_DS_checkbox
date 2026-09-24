// Het contract tussen de UI en de datalaag — het patroon van mit-salessupport
// (zie CLAUDE.md, "Volgende stap"). Twee implementaties: ApiDataProvider op
// lib/api.ts (de echte backend) en MockDataProvider voor UI-werk zonder
// backend (VITE_DATA_BACKEND=mock). Pagina's praten alleen met dit interface,
// nooit rechtstreeks met fetch() of request().
import type { BeeldbankAntwoord, ConversieRegel, ConversieResultaat, ConversieStatus, MeegestuurdeAfbeelding, Pagina } from '../types'

export interface DataProvider {
  /** Kan de server renderen, en welke lettertypen heeft hij? Voor de statuskaart. */
  conversieStatus(): Promise<ConversieStatus>
  /** Welke van deze gekoppelde afbeeldingen heeft de beeldbank op de server? */
  beeldbank(namen: string[]): Promise<BeeldbankAntwoord>
  /**
   * Zet één .docx om; `docxBase64` is de ruwe inhoud van het bestand.
   * `afbeeldingen`: gekoppelde afbeeldingen uit de map van de gebruiker, voor
   * wat de beeldbank niet heeft.
   */
  converteer(bestandsnaam: string, docxBase64: string, afbeeldingen?: MeegestuurdeAfbeelding[]): Promise<ConversieResultaat>
  /** Het conversies-logboek (beheerder), server-side gepagineerd. */
  conversies(page: number, pageSize: number): Promise<Pagina<ConversieRegel>>
}
