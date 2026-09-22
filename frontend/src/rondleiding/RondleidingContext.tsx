import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { bewaarVoortgang, leesVoortgang, type RondleidingStatus } from './opslag'
import { eersteStapVanGroep, groepenVoorRol, stappenVoorRol, type RondleidingGroep, type RondleidingStap } from './stappen'

/**
 * De besturing van de rondleiding: welke stap loopt er, op welk tabblad hoort
 * die stap te staan, en wat is er van deze gebruiker bewaard. De overlay
 * (`Rondleiding.tsx`) doet alleen het tekenen en meten — alles wat met
 * volgorde, rollen en navigatie te maken heeft, zit hier.
 *
 * De rondleiding navigeert ZELF naar het tabblad van een stap. Dat is de kern
 * van wegwijs maken: de overlay vangt klikken af (je mag onderweg geen
 * document uploaden en geen conversie starten), dus wachten tot iemand de goede
 * tab zelf opzoekt zou betekenen dat hij vastloopt. Muteren doet de rondleiding
 * nooit — ze kijkt alleen mee.
 *
 * Elke `route` in `stappen.ts` moet een bestaand tabpad uit App.tsx zijn:
 * anders stuurt de catch-all-route daar door naar /converteren en draait de
 * rondleiding rond. `scripts/check-rondleiding.mjs` bewaakt dat.
 */

/** Waar een `start()`-aanroep vandaan mag beginnen. */
export interface StartOpties {
  /** Bij de eerste stap van deze groep beginnen. */
  groep?: RondleidingGroep
  /** Bij een eerder bewaarde stap verdergaan. `groep` wint als beide er staan. */
  vanafStap?: string
}

interface RondleidingWaarde {
  actief: boolean
  stap: RondleidingStap | null
  /** 1-gebaseerd, voor "Stap n van m". */
  nummer: number
  totaal: number
  richting: 'vooruit' | 'terug'
  /** Is deze gebruiker de rondleiding al eens doorgelopen of weggeklikt? */
  status: RondleidingStatus | null
  automatisch: boolean
  /** Waar iemand de vorige keer stopte (stap-id), of null. */
  bewaardeStap: string | null
  isAdmin: boolean
  start: (opties?: StartOpties) => void
  stop: (status: RondleidingStatus) => void
  volgende: () => void
  vorige: () => void
  slaOver: () => void
  zetAutomatisch: (aan: boolean) => void
  /** Groepen die deze rol te zien krijgt, in volgorde. */
  beschikbareGroepen: RondleidingGroep[]
}

const RondleidingCtx = createContext<RondleidingWaarde | null>(null)

/** Het scherm waar een ingelogde gebruiker binnenkomt (zie de redirect in App.tsx). */
const STARTSCHERM = '/converteren'

export function RondleidingProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useAuth()

  // `session.role` en niet een vinkje uit de UI: dit is dezelfde afleiding die
  // bepaalt of de geschiedenis-tab en de statuskaart überhaupt gerenderd
  // worden. Een gebruiker met een onbekende rol valt in AuthContext terug op
  // 'gebruiker' en krijgt hier dus ook de korte rondleiding — vanzelf, zonder
  // eigen regel.
  const isAdmin = session?.role === 'admin'
  // Per gebruiker gescoped: pc's in de binnendienst worden gedeeld (zie
  // opslag.ts). `user.id` eerst, want dat is de stabiele sleutel uit
  // Motrac-beheer; een e-mailadres kan wijzigen en dan zou iemands voortgang
  // verdwijnen.
  const gebruikerSleutel = String(session?.user.id ?? session?.user.email ?? 'onbekend')

  const [actief, setActief] = useState(false)
  const [index, setIndex] = useState(0)
  const [richting, setRichting] = useState<'vooruit' | 'terug'>('vooruit')
  const [voortgang, setVoortgang] = useState(() => leesVoortgang(gebruikerSleutel))
  // Waar de gebruiker vandaan kwam; daar zetten we hem na afloop weer neer.
  const startPad = useRef(STARTSCHERM)
  const autostartGedaan = useRef(false)

  // Wisselt de gebruiker (uitloggen/inloggen op dezelfde pc), dan hoort ook
  // zijn eigen voortgang erbij.
  useEffect(() => {
    setVoortgang(leesVoortgang(gebruikerSleutel))
  }, [gebruikerSleutel])

  const stappen = useMemo(() => stappenVoorRol(isAdmin), [isAdmin])
  const stap = actief ? (stappen[index] ?? null) : null

  const afsluiten = useCallback(
    (status: RondleidingStatus, gestoptBij: string | null) => {
      setActief(false)
      bewaarVoortgang(gebruikerSleutel, { status, stap: gestoptBij })
      setVoortgang(leesVoortgang(gebruikerSleutel))
      if (location.pathname !== startPad.current) navigate(startPad.current)
    },
    [gebruikerSleutel, location.pathname, navigate],
  )

  const start = useCallback(
    (opties?: StartOpties) => {
      const rolStappen = stappenVoorRol(isAdmin)
      let beginIndex = 0
      if (opties?.groep) {
        const gevonden = eersteStapVanGroep(rolStappen, opties.groep)
        if (gevonden >= 0) beginIndex = gevonden
      } else if (opties?.vanafStap) {
        // Een bewaarde stap-id kan van vóór een rolwissel zijn (de rol ging van
        // admin naar gebruiker) of van vóór een wijziging in stappen.ts. Niet
        // gevonden -> gewoon bij het begin, nooit een lege rondleiding.
        const gevonden = rolStappen.findIndex((s) => s.id === opties.vanafStap)
        if (gevonden >= 0) beginIndex = gevonden
      }
      startPad.current = location.pathname
      setRichting('vooruit')
      setIndex(beginIndex)
      setActief(true)
    },
    [isAdmin, location.pathname],
  )

  // Voorbij de laatste stap is de rondleiding klaar — dat is de enige manier
  // waarop hij "afgerond" heet; wegklikken telt als overgeslagen.
  const volgende = useCallback(() => {
    setRichting('vooruit')
    if (index + 1 >= stappen.length) {
      afsluiten('afgerond', null)
      return
    }
    setIndex(index + 1)
  }, [afsluiten, index, stappen.length])

  const vorige = useCallback(() => {
    setRichting('terug')
    setIndex((i) => Math.max(0, i - 1))
  }, [])

  // Anker niet gevonden en de stap is optioneel: door in de huidige richting.
  // De richting meenemen is geen franje: zonder dit zou "Vorige" bij een stap
  // waarvan het anker ontbreekt (de zijbalklink op een smal scherm) meteen weer
  // vooruit springen, en kwam je nooit terug bij de stap ervoor.
  const slaOver = useCallback(() => {
    if (richting === 'terug') {
      if (index === 0) {
        // Niets meer terug te gaan en deze stap is niet te tonen: draai om,
        // anders blijft de rondleiding op een onzichtbare stap hangen.
        setRichting('vooruit')
        setIndex((i) => Math.min(stappen.length - 1, i + 1))
        return
      }
      setIndex((i) => Math.max(0, i - 1))
      return
    }
    if (index + 1 >= stappen.length) {
      afsluiten('afgerond', null)
      return
    }
    setIndex((i) => i + 1)
  }, [afsluiten, index, richting, stappen.length])

  const stop = useCallback(
    (status: RondleidingStatus) => {
      afsluiten(status, stappen[index]?.id ?? null)
    },
    [afsluiten, index, stappen],
  )

  const zetAutomatisch = useCallback(
    (aan: boolean) => {
      bewaarVoortgang(gebruikerSleutel, { automatisch: aan })
      setVoortgang(leesVoortgang(gebruikerSleutel))
    },
    [gebruikerSleutel],
  )

  // Naar het tabblad van de huidige stap. Alleen navigeren als het pad echt
  // afwijkt, anders duwt dit effect zichzelf in een lus.
  useEffect(() => {
    if (!actief || !stap) return
    if (location.pathname !== stap.route) navigate(stap.route)
  }, [actief, stap, location.pathname, navigate])

  // Eén keer vanzelf starten voor wie de rondleiding nog nooit zag. Bewust
  // alleen op het conversiescherm: dat is het startscherm na inloggen, daar
  // staat de eerste stap ook op zijn plek, en de gebruiker is er niet
  // halverwege een upload. Wie hem ooit afsloot of uitzette, krijgt hem nooit
  // meer vanzelf.
  useEffect(() => {
    if (autostartGedaan.current || actief || !session) return
    if (voortgang.status !== null || !voortgang.automatisch) return
    if (location.pathname !== STARTSCHERM) return
    autostartGedaan.current = true
    start()
  }, [actief, location.pathname, session, start, voortgang.automatisch, voortgang.status])

  const beschikbareGroepen = useMemo(() => groepenVoorRol(isAdmin), [isAdmin])

  const waarde: RondleidingWaarde = {
    actief,
    stap,
    nummer: index + 1,
    totaal: stappen.length,
    richting,
    status: voortgang.status,
    automatisch: voortgang.automatisch,
    bewaardeStap: voortgang.stap,
    isAdmin,
    start,
    stop,
    volgende,
    vorige,
    slaOver,
    zetAutomatisch,
    beschikbareGroepen,
  }

  return <RondleidingCtx.Provider value={waarde}>{children}</RondleidingCtx.Provider>
}

export function useRondleiding(): RondleidingWaarde {
  const ctx = useContext(RondleidingCtx)
  if (!ctx) throw new Error('useRondleiding moet binnen <RondleidingProvider> gebruikt worden')
  return ctx
}
