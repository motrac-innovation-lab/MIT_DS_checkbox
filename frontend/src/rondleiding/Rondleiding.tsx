import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Button, useFocusTrap } from '@motrac/template-ui'
import { useRondleiding } from './RondleidingContext'
import { balonPositie, smalleZijde, SMAL_SCHERM, type Maat, type Rechthoek } from './positie'

/**
 * De zichtbare kant van de rondleiding: een schermvullende laag met een
 * uitsnede rond het element van de huidige stap ("spotlight") en een tekstballon
 * ernaast.
 *
 * Bewust geen tour-bibliotheek (react-joyride, driver.js, intro.js). De
 * fleet-afspraak is "geen bibliotheek per app" (zie CLAUDE.md, punt 1: geen
 * tweede design-system, geen eigen icoonbibliotheek), en zo'n pakket brengt
 * bovendien zijn eigen kleuren, z-indexen en focusgedrag mee terwijl alles hier
 * op de tokens van @motrac/template-ui hoort te staan. Dit is
 * `getBoundingClientRect` + een portal + ~25 regels CSS.
 *
 * De focus-trap, Escape en het teruggeven van de focus komen uit het pakket
 * (`useFocusTrap`) — die hoort niet per app opnieuw geschreven te worden, zie
 * DESIGN_SYSTEM.md daar onder "Accessibility".
 *
 * De laag vangt klikken af. Dat is opzet: dit is uitleg, geen sandbox — je mag
 * onderweg geen document uploaden en geen conversie starten.
 */

// Ruimte tussen de uitsnede en het element zelf.
const GAT_MARGE = 6
// Hoe lang we op een anker wachten na een stapwissel (tabwissel + render + een
// pagina die zijn eigen gegevens nog ophaalt — ConversiePage haalt de
// serverstatus op, GeschiedenisPage het logboek). 15 x 100ms = ruim 1,5s.
const MAX_POGINGEN = 15
// Voor een OPTIONELE stap is dat budget veel te ruim. Zo'n stap is er een die
// we bereid zijn te verliezen — de zijbalklink bestaat op een smal scherm
// helemaal niet — en dan wacht élke telefoongebruiker elke keer anderhalve
// seconde op een element dat er nooit komt. Wachten helpt alleen als het scherm
// nog aan het laden is; is dat klaar, dan verschijnt het anker ook over een
// seconde niet meer.
const MAX_POGINGEN_OPTIONEEL = 6

type AnkerStatus = 'zoeken' | 'gevonden' | 'opgegeven'

/**
 * Het eerste element dat de selector oplevert ÉN ook echt een rechthoek op het
 * scherm heeft. Dat tweede is geen voorzorg: `AppShell` rendert zowel de
 * zijbalk als de tabbalk en verbergt er één van, dus `a[href="/converteren"]`
 * levert op élke schermbreedte twee treffers op waarvan er één 0x0 op positie
 * 0,0 staat. `document.querySelector` pakt de eerste in DOM-volgorde, en dat is
 * op een telefoon juist de verborgene: de uitsnede werd dan een vierkantje van
 * twaalf pixels linksboven, waar niets te zien is. Gemeten op 390, 900 en
 * 1440px breed.
 */
function zichtbaarAnker(selector: string): HTMLElement | null {
  for (const kandidaat of document.querySelectorAll(selector)) {
    if (!(kandidaat instanceof HTMLElement)) continue
    const r = kandidaat.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return kandidaat
  }
  return null
}

function huidigeViewport(): Maat {
  if (typeof window === 'undefined') return { breedte: 1024, hoogte: 768 }
  return { breedte: window.innerWidth, hoogte: window.innerHeight }
}

export default function Rondleiding() {
  const { t, i18n } = useTranslation('rondleiding')
  const { actief, stap, nummer, totaal, volgende, vorige, stop, slaOver } = useRondleiding()

  const [anker, setAnker] = useState<HTMLElement | null>(null)
  const [ankerRect, setAnkerRect] = useState<Rechthoek | null>(null)
  // De stand van het zoeken, MÉT de stap waar die stand bij hoort:
  //   'zoeken'    -> we wachten nog of het element verschijnt
  //   'gevonden'  -> anker staat, uitsnede eromheen
  //   'opgegeven' -> het komt niet meer; tekst gecentreerd tonen
  //
  // Die `stap` erbij is geen administratie maar de kern. Het effect dat hem
  // bijwerkt draait ná het render van een nieuwe stap, dus in dat ene
  // tussenrender hoort de stand nog bij de VORIGE stap. Zonder deze koppeling
  // stond de tekst van de nieuwe stap daar één frame lang in de uitsnede van
  // het oude element.
  const [ankerStand, setAnkerStand] = useState<{ stap: string | null; status: AnkerStatus }>({ stap: null, status: 'zoeken' })
  const [tipMaat, setTipMaat] = useState<Maat>({ breedte: 340, hoogte: 200 })
  const [viewport, setViewport] = useState<Maat>(huidigeViewport)
  const tipRef = useRef<HTMLDivElement>(null)
  const focusVoorStart = useRef<Element | null>(null)
  // `slaOver` in de dependency-array van het zoekeffect hieronder zou de teller
  // terugzetten zodra die functie een nieuwe identiteit krijgt — en dat gebeurt
  // bij elke navigatie, want `afsluiten` in de context hangt aan
  // `location.pathname`. Het effect begon dan telkens opnieuw bij poging 0 en
  // gaf dus nooit op: een optionele stap bleef hangen in plaats van over te
  // slaan. Via een ref blijft het effect afhankelijk van alléén de stap.
  const slaOverRef = useRef(slaOver)
  slaOverRef.current = slaOver

  const stapId = stap?.id ?? null
  const stapAnker = stap?.anker ?? null
  const stapOptioneel = stap?.optioneel ?? false

  // Hoort de huidige stand bij DEZE stap? Zo niet, dan is het zoekeffect nog
  // niet gedraaid en gaat alles wat in de state staat nog over de vorige stap.
  const eigenStand: AnkerStatus = ankerStand.stap === stapId ? ankerStand.status : 'zoeken'
  // Staat de ballon in de DOM? Een stap zonder anker hoeft niets af te wachten
  // en verschijnt meteen; een stap mét anker toont tijdens het zoeken alleen de
  // verduistering (zie de toelichting verderop).
  const tipZichtbaar = actief && !!stap && (!stapAnker || eigenStand !== 'zoeken')

  // ---- anker zoeken --------------------------------------------------------
  // Na een stapwissel bestaat het element vaak nog niet: de tab wisselt, de
  // component rendert, en beide pagina's halen eerst gegevens op. Daarom kort
  // pollen in plaats van één keer kijken.
  useEffect(() => {
    setAnker(null)
    setAnkerRect(null)
    if (!actief || !stapId || !stapAnker) return undefined
    setAnkerStand({ stap: stapId, status: 'zoeken' })

    let gestopt = false
    let timer: number | undefined
    let pogingen = 0

    const zoek = () => {
      if (gestopt) return
      const gevonden = zichtbaarAnker(stapAnker)
      if (gevonden) {
        setAnker(gevonden)
        setAnkerStand({ stap: stapId, status: 'gevonden' })
        return
      }
      pogingen += 1
      if (pogingen >= (stapOptioneel ? MAX_POGINGEN_OPTIONEEL : MAX_POGINGEN)) {
        // Optioneel: gewoon door. Anders de tekst gecentreerd tonen — de uitleg
        // gaat dan nooit verloren, je ziet alleen niet welk element bedoeld
        // wordt. Vastlopen is nooit een optie.
        if (stapOptioneel) slaOverRef.current()
        else setAnkerStand({ stap: stapId, status: 'opgegeven' })
        return
      }
      timer = window.setTimeout(zoek, 100)
    }

    // Eerste poging synchroon: staat het element er al — verreweg het
    // gangbaarste geval — dan is de stand in ditzelfde render al 'gevonden'.
    zoek()
    return () => {
      gestopt = true
      if (timer) window.clearTimeout(timer)
    }
  }, [actief, stapId, stapAnker, stapOptioneel])

  // ---- meten ---------------------------------------------------------------
  const meet = useCallback(() => {
    setViewport(huidigeViewport())
    if (anker) {
      const r = anker.getBoundingClientRect()
      setAnkerRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    const tip = tipRef.current
    if (tip) setTipMaat({ breedte: tip.offsetWidth, hoogte: tip.offsetHeight })
  }, [anker])

  useLayoutEffect(() => {
    if (actief) meet()
  }, [actief, meet, stapId])

  // Meebewegen met scrollen en verkleinen. `capture: true` is hier essentieel
  // en geen voorzorg: scroll bubbelt niet, en in deze app scrollt niet het
  // venster maar `<main class="scroll">` uit AppShell. Zonder capture blijft de
  // uitsnede staan waar hij stond zodra je scrollt.
  useEffect(() => {
    if (!actief) return undefined
    let frame = 0
    const opnieuw = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(meet)
    }
    window.addEventListener('resize', opnieuw)
    document.addEventListener('scroll', opnieuw, { capture: true, passive: true })
    const observer = anker && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(opnieuw) : null
    if (observer && anker) observer.observe(anker)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', opnieuw)
      document.removeEventListener('scroll', opnieuw, true)
      if (observer) observer.disconnect()
    }
  }, [actief, anker, meet])

  // Het element in beeld brengen. Smooth scrollen is asynchroon, dus meten we
  // daarna nog even elke frame mee — anders staat de uitsnede naast het doel.
  useEffect(() => {
    if (!actief || !anker) return undefined
    const rustig = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    anker.scrollIntoView({ block: 'center', inline: 'nearest', behavior: rustig ? 'auto' : 'smooth' })
    let frame = 0
    const einde = Date.now() + 700
    const volg = () => {
      meet()
      if (Date.now() < einde) frame = window.requestAnimationFrame(volg)
    }
    frame = window.requestAnimationFrame(volg)
    return () => window.cancelAnimationFrame(frame)
  }, [actief, anker, meet])

  // ---- focus + toetsenbord -------------------------------------------------
  // Tab-trap, Escape en focus-teruggave uit het pakket. `tipZichtbaar` en niet
  // `actief` als schakelaar: tijdens het zoeken naar een anker staat de ballon
  // niet in de DOM, en een trap die dan wordt opgezet vindt geen ref.
  const sluitViaEscape = useCallback(() => stop('overgeslagen'), [stop])
  useFocusTrap(tipRef, sluitViaEscape, tipZichtbaar)

  // De focus over de héle rondleiding heen teruggeven. `useFocusTrap` doet dat
  // ook, maar per ballon, en die wordt bij elke stapwissel opnieuw opgebouwd —
  // het element dat hij dan onthoudt is de knop uit de vorige ballon, die op
  // dat moment al weg is. Dit effect hangt aan `actief` en overleeft dus de
  // hele rondleiding; het staat NA useFocusTrap zodat zijn opruiming als
  // laatste draait en dus wint.
  //
  // Wat het NIET kan: een startknop die op een ander tabblad stond en tijdens
  // de rondleiding is weggerenderd. Vandaar de `document.contains`-controle —
  // een `focus()` op een losgekoppeld element doet niets en laat de focus op
  // `<body>` staan, precies zoals na het sluiten van elke andere overlay. Dat
  // is vandaag het gangbare geval (de enige startknop staat op /rondleiding en
  // de eerste stap wijst naar /converteren); de controle staat er voor een
  // toekomstige starter op het scherm waar de rondleiding zelf begint.
  useEffect(() => {
    if (!actief) return undefined
    focusVoorStart.current = document.activeElement
    return () => {
      const terug = focusVoorStart.current
      if (terug instanceof HTMLElement && document.contains(terug)) terug.focus({ preventScroll: true })
    }
  }, [actief])

  // De focus op de ballon zelf en niet op de eerste knop (waar `useFocusTrap`
  // hem neerzet). Twee redenen. Eén: die eerste knop is "Overslaan", en dan zou
  // een Enter vlak na een muisklik op "Volgende" de rondleiding beëindigen.
  // Twee: de ballon is de dialoog, dus een schermlezer leest bij het
  // binnenkomen titel én tekst voor (aria-labelledby/-describedby). Een
  // aria-live-gebied zou dat hier niet doen: de ballon wordt bij elke
  // stapwissel opnieuw opgebouwd, en een live-gebied dat pas mét zijn inhoud in
  // de DOM verschijnt meldt niets.
  // preventScroll: anders vecht de browserfocus met scrollIntoView hierboven.
  useEffect(() => {
    if (!tipZichtbaar) return
    tipRef.current?.focus({ preventScroll: true })
  }, [tipZichtbaar, stapId])

  useEffect(() => {
    if (!actief) return undefined
    // Escape zit in useFocusTrap; hier alleen het bladeren.
    const opToets = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        volgende()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        vorige()
      }
    }
    document.addEventListener('keydown', opToets)
    return () => document.removeEventListener('keydown', opToets)
  }, [actief, volgende, vorige])

  if (!actief || !stap) return null

  // De i18n-pariteitscheck bewaakt alleen NL vs EN, niet of de sleutel die
  // `stappen.ts` noemt ook echt bestaat. `scripts/check-rondleiding.mjs` doet
  // dat tijdens de build; deze waarschuwing is de snelle variant tijdens het
  // ontwikkelen.
  if (import.meta.env.DEV && !i18n.exists(`rondleiding:stap.${stap.id}.titel`)) {
    // eslint-disable-next-line no-console
    console.warn(`[rondleiding] geen vertaling voor stap "${stap.id}"`)
  }

  // Nog aan het zoeken naar het anker: wél de verduistering, GEEN tekst.
  // Zonder dit stond de tekst van een stap die zo meteen overgeslagen wordt
  // anderhalve seconde in beeld. Staat het element er al — het gangbare geval —
  // dan is dit render er niet eens, want de eerste zoekpoging is synchroon.
  if (!tipZichtbaar) {
    return createPortal(<div className="rondleiding-laag rondleiding-laag-dicht" />, document.body)
  }

  const laatste = nummer >= totaal

  // De uitsnede hangt NIET alleen aan `ankerRect`, maar aan de vraag of het
  // anker van DEZE stap gevonden is. `ankerRect` wordt in een effect gewist, en
  // dat effect draait pas ná het render van de nieuwe stap — dus één frame lang
  // staat daar nog de rechthoek van het vorige element in. Zonder deze
  // koppeling erfde een gecentreerde stap (welkom, "Wat je terugkrijgt") de
  // uitsnede van de stap ervoor en lichtte hij een element op waar zijn tekst
  // niet over ging.
  const gat = eigenStand === 'gevonden' && ankerRect
    ? {
      top: Math.max(0, ankerRect.top - GAT_MARGE),
      left: Math.max(0, ankerRect.left - GAT_MARGE),
      width: ankerRect.width + GAT_MARGE * 2,
      height: ankerRect.height + GAT_MARGE * 2,
    }
    : null

  const smal = viewport.breedte < SMAL_SCHERM
  // `gat` en niet `ankerRect`, om dezelfde reden als hierboven: bij een
  // gecentreerde stap staat er één frame lang nog de rechthoek van het vorige
  // element in `ankerRect`, en dan sprong de ballon eerst naast dat element
  // voordat hij naar het midden ging.
  const positie = smal ? null : balonPositie(gat ? ankerRect : null, tipMaat, viewport, stap.plaatsing)
  // Op een smal scherm plakt de ballon tegen een schermrand; welke, hangt af van
  // waar het aangewezen element staat (zie smalleZijde).
  const smalleKant = smal ? smalleZijde(gat, viewport) : null

  // Shift+Tab terwijl de focus op de ballon zélf staat (de stand na elke
  // stapwissel, zie hierboven). `useFocusTrap` kent alleen zijn eigen knoppen
  // als grens en laat dit ene geval door — de focus zou dan achter de
  // verduistering belanden, waar niets te bedienen valt. De trap luistert in de
  // capture-fase op document en doet hier niets, dus deze handler komt daarna
  // gewoon aan bod.
  function opTipToets(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !e.shiftKey || e.target !== e.currentTarget) return
    const knoppen = e.currentTarget.querySelectorAll('button')
    const laatsteKnop = knoppen[knoppen.length - 1]
    if (!laatsteKnop) return
    e.preventDefault()
    laatsteKnop.focus()
  }

  return createPortal(
    <div className={gat ? 'rondleiding-laag' : 'rondleiding-laag rondleiding-laag-dicht'}>
      {gat && <div className="rondleiding-gat" style={gat} />}
      <div
        ref={tipRef}
        className={smalleKant ? `rondleiding-tip rondleiding-tip-${smalleKant}aan` : 'rondleiding-tip'}
        style={positie ? { top: positie.top, left: positie.left } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rondleiding-titel"
        aria-describedby="rondleiding-tekst"
        tabIndex={-1}
        onKeyDown={opTipToets}
      >
        <p className="rondleiding-voortgang">{t('voortgang', { nummer, totaal })}</p>
        <h2 id="rondleiding-titel" className="rondleiding-titel">
          {t(`stap.${stap.id}.titel`)}
        </h2>
        <p id="rondleiding-tekst" className="rondleiding-tekst">
          {t(`stap.${stap.id}.tekst`)}
        </p>
        <div className="rondleiding-knoppen">
          <Button variant="ghost" small onClick={() => stop('overgeslagen')}>
            {t('overslaan')}
          </Button>
          <div className="rondleiding-knoppen-rechts">
            <Button variant="ghost" small disabled={nummer <= 1} onClick={vorige}>
              {t('vorige')}
            </Button>
            <Button variant="primary" small onClick={volgende}>
              {laatste ? t('klaar') : t('volgende')}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
