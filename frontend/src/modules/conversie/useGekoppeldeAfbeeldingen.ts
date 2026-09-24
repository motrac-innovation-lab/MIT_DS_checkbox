// De gekoppelde afbeeldingen van de gekozen .docx: welke zijn het, welke heeft
// de beeldbank op de server, en welke moet de app zelf uit de map van de
// gebruiker meesturen. De beeldbank is eerste keus (zo werkt het ook zonder
// handeling); de map is de aanvulling — zie lib/afbeeldingenMap.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useData } from '../../context/DataContext'
import { heeftToegang, kanMapKiezen, kiesMap, onthoudenMap, zoekInMap, type MapHandle } from '../../lib/afbeeldingenMap'
import { leesBestandAlsBase64 } from '../../lib/bestanden'
import { gekoppeldeAfbeeldingen } from '../../lib/docxKoppelingen'
import type { MeegestuurdeAfbeelding } from '../../types'

export interface KoppelingStand {
  /** Alle afbeeldingen die de .docx koppelt. */
  namen: string[]
  /** Daarvan: niet in de beeldbank op de server. */
  ontbrekend: string[]
  /** Uit de map of losse bestanden van de gebruiker, op kleine-letternaam. */
  gekozen: Record<string, File>
  /** Aan het uitlezen, controleren of zoeken. */
  bezig: boolean
  /** De onthouden of zojuist gekozen map. */
  map: MapHandle | null
  /** Is er in `map` al gezocht? Dan betekent "nog ontbrekend": niet in die map. */
  mapDoorzocht: boolean
}

export function useGekoppeldeAfbeeldingen(bestand: File | null) {
  const data = useData()
  const [stand, setStand] = useState<KoppelingStand | null>(null)
  // Een ander bestand kiezen terwijl het vorige nog gecontroleerd wordt: alleen
  // de uitkomst van het laatste telt.
  const generatie = useRef(0)

  useEffect(() => {
    const mijn = ++generatie.current
    setStand(null)
    if (!bestand) return
    void (async () => {
      const namen = await gekoppeldeAfbeeldingen(bestand)
      if (mijn !== generatie.current || !namen.length) return
      setStand({ namen, ontbrekend: [], gekozen: {}, bezig: true, map: null, mapDoorzocht: false })
      let ontbrekend = namen
      try {
        ontbrekend = (await data.beeldbank(namen)).ontbrekend
      } catch {
        // Beeldbank niet te raadplegen: dan alles uit de map proberen.
      }
      let map: MapHandle | null = null
      let gekozen: Record<string, File> = {}
      let mapDoorzocht = false
      if (ontbrekend.length) {
        map = await onthoudenMap()
        // Zonder klik mag de browser niets vragen; heeft hij de toestemming al
        // bewaard, dan zoekt de app meteen.
        if (map && (await heeftToegang(map, false))) {
          gekozen = await zoekInMap(map, ontbrekend)
          mapDoorzocht = true
        }
      }
      if (mijn !== generatie.current) return
      setStand({ namen, ontbrekend, gekozen, bezig: false, map, mapDoorzocht })
    })()
  }, [bestand, data])

  /** Vanuit een klik: de onthouden map openen, of (opnieuw) een map kiezen. */
  const kiesOfOpenMap = useCallback(async () => {
    if (!stand) return
    const mijn = generatie.current
    try {
      let map = stand.mapDoorzocht ? null : stand.map
      if (map && !(await heeftToegang(map, true))) map = null
      if (!map) map = await kiesMap()
      setStand((s) => s && { ...s, bezig: true })
      const gevonden = await zoekInMap(map, stand.ontbrekend)
      if (mijn !== generatie.current) return
      setStand((s) => s && { ...s, bezig: false, map, mapDoorzocht: true, gekozen: { ...s.gekozen, ...gevonden } })
    } catch {
      // Annuleren in de mapkiezer (AbortError) of geen toestemming: niets veranderd.
      if (mijn === generatie.current) setStand((s) => s && { ...s, bezig: false })
    }
  }, [stand])

  /** Terugval zonder map-API: de gebruiker kiest de bestanden zelf. */
  const kiesBestanden = useCallback((bestanden: FileList | null) => {
    setStand((s) => {
      if (!s) return s
      const extra: Record<string, File> = {}
      for (const f of Array.from(bestanden ?? [])) {
        if (s.ontbrekend.some((n) => n.toLowerCase() === f.name.toLowerCase())) extra[f.name.toLowerCase()] = f
      }
      return { ...s, gekozen: { ...s.gekozen, ...extra } }
    })
  }, [])

  /** Wat er mee moet met de conversie: de gekozen bestanden, onder de naam uit de .docx. */
  const meeTeSturen = useCallback(async (): Promise<MeegestuurdeAfbeelding[]> => {
    if (!stand) return []
    const namen = stand.ontbrekend.filter((n) => stand.gekozen[n.toLowerCase()])
    return Promise.all(namen.map(async (n) => ({ bestandsnaam: n, base64: await leesBestandAlsBase64(stand.gekozen[n.toLowerCase()]) })))
  }, [stand])

  return { stand, kiesOfOpenMap, kiesBestanden, meeTeSturen, kanMapKiezen: kanMapKiezen() }
}
