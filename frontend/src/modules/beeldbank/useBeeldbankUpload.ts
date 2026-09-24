import { useCallback, useState } from 'react'
import { useData } from '../../context/DataContext'
import { ApiError } from '../../lib/api'
import { leesBestandAlsBase64 } from '../../lib/bestanden'
import type { BeeldbankUpload, BeeldbankVergelijking } from '../../types'

// Dezelfde formaten als de backend (BEELD_MIME in gekoppeldeAfbeeldingen.js).
const BEELD_EXTENSIES = /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg)$/i
/** Gelijk aan MAX_BEELD_BYTES in backend/lib/beeldbank.js. */
export const MAX_BEELD_BYTES = 20 * 1024 * 1024
// Per verzoek: ruim onder de bodylimiet van /api/beeldbank (±29 MB base64),
// en niet meer bestanden dan de route toelaat.
const MAX_BATCH_BYTES = 8 * 1024 * 1024
const MAX_BATCH_BESTANDEN = 100
const MAX_VERGELIJK = 2000

export interface Selectie {
  /** Te uploaden, op kleine-letternaam ontdubbeld (laatste wint). */
  bestanden: File[]
  vergelijking: BeeldbankVergelijking
  /** Namen die in de gekozen map vaker voorkwamen (andere submappen). */
  dubbel: string[]
  /** Geen beeldbestand: overgeslagen. */
  overgeslagen: number
  teGroot: string[]
}

export interface Voortgang {
  klaar: number
  totaal: number
}

/**
 * De upload van de beheerpagina: een hele map (de batch AFBEELDINGEN CPQ) of
 * losse bestanden (een nieuw product) gaan door dezelfde stappen — filteren
 * op beeldformaat, vergelijken met wat de server al heeft (zelfde naam en
 * grootte = ongewijzigd), en in stukken versturen zodat één verzoek nooit
 * boven de bodylimiet uitkomt.
 */
export function useBeeldbankUpload(naUpload: () => void) {
  const data = useData()
  const [selectie, setSelectie] = useState<Selectie | null>(null)
  const [bezig, setBezig] = useState(false)
  const [voortgang, setVoortgang] = useState<Voortgang | null>(null)
  const [uitkomst, setUitkomst] = useState<BeeldbankUpload | null>(null)
  const [fout, setFout] = useState<string | null>(null)

  const kies = useCallback(async (lijst: FileList | null) => {
    setUitkomst(null)
    setFout(null)
    setSelectie(null)
    if (!lijst?.length) return
    const opNaam = new Map<string, File>()
    const dubbel = new Set<string>()
    const teGroot: string[] = []
    let overgeslagen = 0
    for (const bestand of Array.from(lijst)) {
      if (!BEELD_EXTENSIES.test(bestand.name)) { overgeslagen++; continue }
      if (bestand.size > MAX_BEELD_BYTES) { teGroot.push(bestand.name); continue }
      const sleutel = bestand.name.toLowerCase()
      if (opNaam.has(sleutel)) dubbel.add(bestand.name)
      opNaam.set(sleutel, bestand)
    }
    const bestanden = [...opNaam.values()]
    setBezig(true)
    try {
      const vergelijking: BeeldbankVergelijking = { nieuw: [], gewijzigd: [], gelijk: [] }
      for (let i = 0; i < bestanden.length; i += MAX_VERGELIJK) {
        const stuk = await data.beeldbankVergelijk(bestanden.slice(i, i + MAX_VERGELIJK).map((b) => ({ bestandsnaam: b.name, grootte: b.size })))
        vergelijking.nieuw.push(...stuk.nieuw)
        vergelijking.gewijzigd.push(...stuk.gewijzigd)
        vergelijking.gelijk.push(...stuk.gelijk)
      }
      setSelectie({ bestanden, vergelijking, dubbel: [...dubbel], overgeslagen, teGroot })
    } catch (e) {
      setFout(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBezig(false)
    }
  }, [data])

  const upload = useCallback(async (ookOngewijzigd: boolean) => {
    if (!selectie) return
    const gelijk = new Set(selectie.vergelijking.gelijk.map((n) => n.toLowerCase()))
    const teSturen = selectie.bestanden.filter((b) => ookOngewijzigd || !gelijk.has(b.name.toLowerCase()))
    const totaal: BeeldbankUpload = { opgeslagen: [], geweigerd: [] }
    setBezig(true)
    setFout(null)
    setUitkomst(null)
    setVoortgang({ klaar: 0, totaal: teSturen.length })
    try {
      let i = 0
      while (i < teSturen.length) {
        // Een stuk vullen tot de byte- of bestandsgrens; één groot bestand gaat alleen.
        const stuk: File[] = []
        let bytes = 0
        while (i < teSturen.length && stuk.length < MAX_BATCH_BESTANDEN && (stuk.length === 0 || bytes + teSturen[i].size <= MAX_BATCH_BYTES)) {
          bytes += teSturen[i].size
          stuk.push(teSturen[i++])
        }
        const antwoord = await data.beeldbankUpload(
          await Promise.all(stuk.map(async (b) => ({ bestandsnaam: b.name, base64: await leesBestandAlsBase64(b) }))),
        )
        totaal.opgeslagen.push(...antwoord.opgeslagen)
        totaal.geweigerd.push(...antwoord.geweigerd)
        setVoortgang({ klaar: i, totaal: teSturen.length })
      }
      setSelectie(null)
    } catch (e) {
      // Wat al binnen is, blijft binnen: de uitkomst toont het deel dat lukte.
      setFout(e instanceof ApiError ? e.message : String(e))
    } finally {
      setUitkomst(totaal)
      setVoortgang(null)
      setBezig(false)
      naUpload()
    }
  }, [data, naUpload, selectie])

  const wis = useCallback(() => {
    setSelectie(null)
    setUitkomst(null)
    setFout(null)
  }, [])

  return { selectie, bezig, voortgang, uitkomst, fout, kies, upload, wis }
}
