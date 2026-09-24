// Domeinmodellen van de Sales offerte converter. De vormen spiegelen de
// JSON van backend/server.js (POST /api/conversies, GET /api/conversies/status,
// GET /api/conversies) één op één — camelCase, Nederlandse veldnamen.

/**
 * App-rol, afgeleid van het profiel in Motrac-beheer. Dit zijn de twee
 * standaard `app_rollen` die Motrac-beheer voor elke nieuwe app aanmaakt
 * (zie context/AuthContext.tsx voor de afleiding uit de ruwe rolstring).
 */
export type Role = 'gebruiker' | 'admin'

/** Vergelijking van de lettertypen die het document vroeg met die in de PDF. */
export interface Lettertypen {
  gevraagd: string[]
  inPdf: string[]
  /** Gevraagd maar niet in de PDF: door LibreOffice vervangen. */
  vervangen: string[]
}

/** Antwoord van POST /api/conversies. */
export interface ConversieResultaat {
  /** Naam voor de download, met .pdf. */
  bestandsnaam: string
  aantalCheckboxen: number
  pdfBase64: string
  lettertypen: Lettertypen
  engine: string
  duurMs: number
  /** Aantal Wingdings-2-symboolruns dat de voorbewerking in ☐ veranderde. */
  symbolenVervangen: number
  /** Ankers waarvan de positie geschat is (☐ midden in een tekstregel). */
  ankersGeschat: number
  /**
   * Afbeeldingen die de .docx alleen koppelt (bv. E:\… op een Motrac-pc) en die
   * niet in de afbeeldingenmap van de server staan — in de PDF een lege plek.
   * Optioneel: een oudere backend stuurt het veld niet mee.
   */
  ontbrekendeAfbeeldingen?: string[]
}

/** Antwoord van GET /api/conversies/status. */
export interface ConversieStatus {
  engine: string
  /** Kan de server op dit moment renderen (LibreOffice gevonden / dienst bereikbaar)? */
  beschikbaar: boolean
  libreoffice: { versie: string | null } | null
  lettertypen: {
    vereist: string[]
    ontbreekt: string[]
    bestanden: { bestand: string; families: string[] }[]
    /**
     * Gaan de fontbestanden van de server mee in de render? Alleen bij de
     * lokale soffice-engine; bij Gotenberg komen de lettertypen uit de image
     * van de dienst en zegt `ontbreekt` niets over de PDF.
     */
    viaFontmappen: boolean
  }
  maxDocxBytes: number
}

/** Eén regel uit het conversies-logboek (GET /api/conversies, beheerder). */
export interface ConversieRegel {
  id: number
  aangemaaktOp: string
  actorNaam: string
  actorEmail: string | null
  bestandsnaam: string
  status: 'geslaagd' | 'mislukt'
  aantalCheckboxen: number | null
  duurMs: number | null
  engine: string | null
  lettertypenVervangen: string[]
  foutcode: string | null
  foutmelding: string | null
}

/** Server-side gepagineerde lijst, zelfde vorm als het audit-logboek. */
export interface Pagina<T> {
  items: T[]
  page: number
  pageSize: number
  totaal: number
}
