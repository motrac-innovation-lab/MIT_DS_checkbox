// Bestand ↔ base64, voor het transport van de .docx naar de backend en de PDF
// terug. De download zelf loopt via biedBestandAan() uit het pakket.
import { stripDataUrl } from '@motrac/template-ui'

/** De ruwe inhoud van een File als base64 (zonder data:-prefix). */
export function leesBestandAlsBase64(bestand: File): Promise<string> {
  return new Promise((klaar, mislukt) => {
    const lezer = new FileReader()
    lezer.onerror = () => mislukt(lezer.error ?? new Error('Bestand lezen mislukt.'))
    lezer.onload = () => klaar(stripDataUrl(String(lezer.result ?? '')))
    lezer.readAsDataURL(bestand)
  })
}

/** base64 → Blob, in stukken zodat een PDF van tientallen MB de call-stack niet opblaast. */
export function base64NaarBlob(base64: string, mime: string): Blob {
  const binair = atob(base64)
  const bytes = new Uint8Array(binair.length)
  for (let i = 0; i < binair.length; i++) bytes[i] = binair.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** "1,8 MB" / "640 kB", voor de bestandsregel onder het uploadveld. */
export function leesbareGrootte(bytes: number, taal: string): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${mb.toLocaleString(taal, { maximumFractionDigits: 1 })} MB`
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(taal)} kB`
}
