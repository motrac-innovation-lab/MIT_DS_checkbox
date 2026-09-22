import { useTranslation } from 'react-i18next'
import { Button, Card, Checkbox, Hint, Icon, SectionLabel } from '@motrac/template-ui'
import { useRondleiding } from './RondleidingContext'

/**
 * Het "aanzetten"-adres van de module: de rondleiding in zijn geheel starten,
 * meteen beginnen bij het onderdeel waar je iets mee moet, of hervatten waar je
 * gebleven was. Plus de schakelaar of hij bij een eerste bezoek vanzelf mag
 * starten.
 *
 * Los van `RondleidingPagina` gehouden omdat dit blok ook de SLOTSTAP van de
 * rondleiding zelf is (`data-rondleiding="kaart"`): daar eindigt de rondleiding,
 * zodat de laatste dia meteen het adres aanwijst waarop je hem terugvindt.
 * Het attribuut staat op een wikkeldiv en niet op `<Card>`: die component
 * destructureert alleen title/icon/action/children en laat de rest vallen.
 *
 * Welke knoppen er staan, hangt van de rol af: `beschikbareGroepen` komt uit
 * `stappenVoorRol()`, dus een gewone gebruiker ziet hier twee knoppen (het
 * scherm zelf, converteren) en een beheerder drie.
 */
export default function RondleidingKaart() {
  const { t } = useTranslation('rondleiding')
  const { start, status, automatisch, bewaardeStap, zetAutomatisch, beschikbareGroepen } = useRondleiding()

  return (
    // data-rondleiding: anker voor de slotstap van de rondleiding zelf.
    <div data-rondleiding="kaart">
      <Card>
        <SectionLabel icon="compass">{t('kaart.titel')}</SectionLabel>
        <div className="rondleiding-kaart">
          <p>{t('kaart.intro')}</p>
          <div className="rondleiding-kaart-knoppen">
            <Button onClick={() => start()}>
              <Icon name="arrow-right" size={15} />
              {status === null ? t('kaart.startKnop') : t('kaart.opnieuwKnop')}
            </Button>
            {/* Alleen aanbieden als er echt iets te hervatten valt: wie hem
                helemaal uitliep heeft geen halve stap meer staan. */}
            {status === 'overgeslagen' && bewaardeStap && (
              <Button variant="ghost" onClick={() => start({ vanafStap: bewaardeStap })}>
                <Icon name="rotate-ccw" size={15} />
                {t('kaart.hervatKnop')}
              </Button>
            )}
          </div>
          <Hint>{t('kaart.groepenIntro')}</Hint>
          <div className="rondleiding-kaart-knoppen">
            {beschikbareGroepen.map((groep) => (
              <Button key={groep} variant="ghost" small onClick={() => start({ groep })}>
                {t(`groep.${groep}`)}
              </Button>
            ))}
          </div>
          <Checkbox
            label={t('kaart.automatisch')}
            hint={t('kaart.automatischUitleg')}
            checked={automatisch}
            onChange={(e) => zetAutomatisch(e.target.checked)}
          />
        </div>
      </Card>
    </div>
  )
}
