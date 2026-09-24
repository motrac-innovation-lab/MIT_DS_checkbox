import { useTranslation } from 'react-i18next'
import { Alert, Button, Field, Hint, Input, Tag } from '@motrac/template-ui'
import type { useGekoppeldeAfbeeldingen } from './useGekoppeldeAfbeeldingen'

/**
 * Onder het uploadveld: de afbeeldingen die de gekozen .docx alleen koppelt
 * aan de netwerkschijf. Staan ze allemaal in de beeldbank van de server, dan
 * alleen een regel ter info. Zo niet, dan vraagt dit blok om de map
 * AFBEELDINGEN CPQ (of, in een browser zonder map-API, om de losse bestanden)
 * en laat per afbeelding zien of hij gevonden is. Converteren mag altijd — wat
 * ontbreekt wordt in de PDF een lege plek en het resultaatblok meldt dat.
 */
export function GekoppeldeAfbeeldingen({ koppelingen, uitgeschakeld }: {
  koppelingen: ReturnType<typeof useGekoppeldeAfbeeldingen>
  uitgeschakeld: boolean
}) {
  const { t } = useTranslation('common')
  const { stand, kiesOfOpenMap, kiesBestanden, kanMapKiezen } = koppelingen
  if (!stand) return null

  if (stand.bezig && !stand.ontbrekend.length) return <Hint>{t('conversie.afbeeldingen.controleren')}</Hint>
  if (!stand.ontbrekend.length) return <Hint>{t('conversie.afbeeldingen.uitBeeldbank', { aantal: stand.namen.length })}</Hint>

  const gevonden = (naam: string) => Boolean(stand.gekozen[naam.toLowerCase()])
  const allesGevonden = stand.ontbrekend.every(gevonden)
  const mapNaam = stand.map?.name ?? ''

  const knopTekst = stand.mapDoorzocht
    ? t('conversie.afbeeldingen.andereMap')
    : stand.map ? t('conversie.afbeeldingen.mapOpenen', { map: mapNaam }) : t('conversie.afbeeldingen.mapKiezen')

  const tekst = allesGevonden
    ? (stand.mapDoorzocht ? t('conversie.afbeeldingen.gevondenInMap', { map: mapNaam }) : t('conversie.afbeeldingen.gevondenGekozen'))
    : (stand.mapDoorzocht ? t('conversie.afbeeldingen.nietInMap', { map: mapNaam }) : t('conversie.afbeeldingen.nodigTekst'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Alert
        tone={allesGevonden ? 'ok' : 'warn'}
        titel={allesGevonden ? t('conversie.afbeeldingen.gevondenTitel') : t('conversie.afbeeldingen.nodigTitel')}
        actie={kanMapKiezen && !allesGevonden ? (
          <Button small variant="ghost" type="button" onClick={() => void kiesOfOpenMap()} disabled={uitgeschakeld || stand.bezig}>
            {knopTekst}
          </Button>
        ) : undefined}
      >
        {tekst}
        {/* `.offerte-lettertypen` is inline-flex; het blok eromheen zet de rij op een eigen regel. */}
        <div style={{ marginTop: 8 }}>
          <div className="offerte-lettertypen">
            {stand.ontbrekend.map((naam) => (
              <Tag key={naam} tone={gevonden(naam) ? 'ok' : 'warn'}>
                {naam} · {gevonden(naam) ? t('conversie.afbeeldingen.gevonden') : t('conversie.afbeeldingen.ontbreekt')}
              </Tag>
            ))}
          </div>
        </div>
      </Alert>
      {stand.bezig && <Hint>{t('conversie.afbeeldingen.zoeken')}</Hint>}
      {!kanMapKiezen && !allesGevonden && (
        <Field label={t('conversie.afbeeldingen.bestandenVeld')} hint={t('conversie.afbeeldingen.bestandenHint')}>
          <Input
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.gif,.bmp,.tif,.tiff,.emf,.wmf,.svg,image/*"
            onChange={(e) => kiesBestanden(e.target.files)}
            disabled={uitgeschakeld}
          />
        </Field>
      )}
    </div>
  )
}
