// De echte datalaag: elke operatie is precies één aanroep van de ene
// fetch-helper (lib/api.ts) naar de eigen backend. Geen extra logica hier —
// validatie en foutteksten komen van de server, in de fleet-envelop die
// request() al als ApiError teruggeeft.
import { request } from './api'
import type { DataProvider } from './dataProvider'
import type { BeeldbankAntwoord, ConversieRegel, ConversieResultaat, ConversieStatus, MeegestuurdeAfbeelding, Pagina } from '../types'

export class ApiDataProvider implements DataProvider {
  conversieStatus(): Promise<ConversieStatus> {
    return request<ConversieStatus>('/api/conversies/status')
  }

  beeldbank(namen: string[]): Promise<BeeldbankAntwoord> {
    return request<BeeldbankAntwoord>('/api/conversies/afbeeldingen', { method: 'POST', body: { namen } })
  }

  converteer(bestandsnaam: string, docxBase64: string, afbeeldingen?: MeegestuurdeAfbeelding[]): Promise<ConversieResultaat> {
    // Het bestand reist als base64 in de JSON-body: zo blijft de ene
    // fetch-helper (bearer, fout-envelop, sessie-verlopen) ongewijzigd en is er
    // geen tweede transportpad voor multipart. De backend parseert dit pad
    // met een eigen, ruimere bodylimiet (zie server.js).
    return request<ConversieResultaat>('/api/conversies', { method: 'POST', body: { bestandsnaam, docxBase64, ...(afbeeldingen?.length ? { afbeeldingen } : {}) } })
  }

  conversies(page: number, pageSize: number): Promise<Pagina<ConversieRegel>> {
    const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    return request<Pagina<ConversieRegel>>(`/api/conversies?${q}`)
  }
}
