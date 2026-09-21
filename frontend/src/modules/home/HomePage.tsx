import { useTranslation } from 'react-i18next'
import { Card, Hint } from '@motrac/template-ui'
import { useAuth } from '../../context/AuthContext'

/**
 * Startpagina van het skelet. Bewust kaal: één welkomstkaart en één kaart die
 * zegt wat er nog komt. Zodra het domein (het omzetten van sales-offertes)
 * bekend is, wordt dit de plek waar de gebruiker kiest waar hij aan werkt —
 * zie mit-salessupport/frontend/src/modules/home/HomePage.tsx voor hoe dat er
 * in de norm-app uitziet (ingangen met open aantallen uit de datalaag).
 *
 * Paginakop: `.page-head > h1.page-h` (22px) en nooit `.t-h1` (36px) — dat is
 * de norm uit docs/UI-UX-PLAN-PER-APP.md van het pakket.
 */
export function HomePage() {
  const { t } = useTranslation('common')
  const { session } = useAuth()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-head">
        <h1 className="page-h">{t('app.titel')}</h1>
      </div>

      <Card>
        <p style={{ margin: 0 }}>{t('home.welkom')}</p>
        {session && (
          <Hint>{t('home.ingelogdAls', { naam: session.user.naam, rol: t(`rollen.${session.role}`) })}</Hint>
        )}
      </Card>

      <Card title={t('home.volgendeStapTitel')} icon="layers">
        <p className="hint" style={{ margin: 0 }}>{t('home.volgendeStapTekst')}</p>
      </Card>
    </div>
  )
}
