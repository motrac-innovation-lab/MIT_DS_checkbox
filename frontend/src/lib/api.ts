// Eén fetch-helper voor de eigen backend (/api/*): bearer-token uit de
// gedeelde auth-client, JSON heen en terug, en de fout-envelop van de fleet
// ({ error: { code, message } }) als ApiError. Alle toekomstige datalaag-
// aanroepen horen hierlangs te lopen — niet een losse fetch() per pagina.
import { getStoredToken } from './motracAuth'

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

interface RequestOpties {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
}

export async function request<T>(pad: string, { method = 'GET', body, headers = {} }: RequestOpties = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${pad}`, {
    method,
    headers: {
      Authorization: `Bearer ${getStoredToken() ?? ''}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  // De backend kent het token niet (meer): @motrac/auth-client luistert naar
  // dit window-event en zet de sessie op "verlopen", zodat het loginscherm
  // met de juiste melding verschijnt — geen eigen 401-afhandeling per pagina.
  if (res.status === 401) window.dispatchEvent(new Event('motrac:sessie-verlopen'))

  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const fout = (data as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(fout?.message ?? `Verzoek mislukt (${res.status}).`, fout?.code ?? 'UNKNOWN', res.status)
  }
  return data as T
}
