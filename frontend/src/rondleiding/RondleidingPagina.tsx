import { useTranslation } from 'react-i18next'
import { Hint } from '@motrac/template-ui'
import RondleidingKaart from './RondleidingKaart'
import { useRondleiding } from './RondleidingContext'

/**
 * De tab `rondleiding`. Paginakop volgens de norm: `.page-head > h1.page-h`,
 * net als ConversiePage en GeschiedenisPage.
 *
 * De pagina staat in de zijbalk onderin (`onderaan: true`) en op mobiel achter
 * de hamburger (`alleenInMenu`), zodat hij geen van de kostbare posities in de
 * TabBar opsnoept — de rondleiding is een secundaire bestemming, geen
 * dagelijkse taak. Zie `tabs` in App.tsx.
 */
export default function RondleidingPagina() {
  const { t } = useTranslation('rondleiding')
  const { isAdmin } = useRondleiding()

  return (
    <div className="rondleiding-pagina">
      <div className="page-head">
        <h1 className="page-h">{t('pagina.titel')}</h1>
      </div>
      {/* Wat de rondleiding laat zien verschilt per rol, en dat hoort op deze
          pagina te staan: een beheerder die zich afvraagt of zijn collega's
          straks het logboek uitgelegd krijgen, leest het hier. */}
      <Hint>{isAdmin ? t('pagina.uitlegAdmin') : t('pagina.uitlegGebruiker')}</Hint>
      <RondleidingKaart />
    </div>
  )
}
