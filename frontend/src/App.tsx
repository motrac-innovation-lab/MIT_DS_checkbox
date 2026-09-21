import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AppShell,
  FeedbackWidget,
  LanguageSwitcher,
  UiTextProvider,
  feedbackMenuTab,
  useFeedbackPad,
  useMobiel,
  type Tab,
  type UiTeksten,
} from '@motrac/template-ui'
import { useAuth } from './context/AuthContext'
import { SUPPORTED_LANGUAGES } from './i18n/languages'
import { setLanguage } from './i18n'
import { verstuurFeedback } from './lib/feedback'
import { LoginPage } from './modules/auth/LoginPage'
import { HomePage } from './modules/home/HomePage'

/**
 * BESCHERMD (zie CLAUDE.md): geeft de vertaalde teksten die @motrac/template-ui
 * zelf toont (labels/aria's van het pakket, de FeedbackWidget) door aan dat
 * pakket. Zelfde brug als de rest van de fleet (mit-salessupport,
 * motrac-restlast). Het `ui`-blok in locales/<taal>/common.json spiegelt
 * `STANDAARD_UI_TEKSTEN` uit het pakket — komt daar een sleutel bij, zet hem
 * in beide talen erbij.
 */
function UiTekstBrug({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')
  return (
    <UiTextProvider teksten={t('ui', { returnObjects: true }) as Partial<UiTeksten>}>
      {children}
    </UiTextProvider>
  )
}

// Taalkiezer voor de shell. resolvedLanguage en niet language (die kan
// "nl-NL" zijn en dan matcht geen enkele rij), setLanguage uit de eigen
// i18n-init — zie docs/platform/i18n-language-switcher.md in de base.
function TaalKiezer() {
  const { t, i18n } = useTranslation('common')
  return (
    <LanguageSwitcher
      talen={SUPPORTED_LANGUAGES}
      actief={i18n.resolvedLanguage ?? i18n.language}
      onKies={setLanguage}
      label={t('ui.taal')}
    />
  )
}

export default function App() {
  const { session, status } = useAuth()
  const { t } = useTranslation('common')

  if (status === 'loading') {
    return (
      <div className="login">
        <p className="hint">{t('algemeen.laden')}</p>
      </div>
    )
  }

  return (
    // Om de héle routeboom heen, dus ook om LoginPage: ook het loginscherm
    // toont componenten uit template-ui met eigen teksten.
    <UiTekstBrug>
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
        {/* Elke ingelogde rol mag naar binnen — er zijn nog geen rolspecifieke
            schermen; voeg rol-guards hier toe zodra dat nodig is. Wildcard:
            HomeShell rendert zijn eigen geneste <Routes>. */}
        <Route path="/*" element={session ? <HomeShell /> : <Navigate to="/login" replace />} />
      </Routes>
    </UiTekstBrug>
  )
}

// De shell zoals mit-salessupport (de norm-app) hem bedraadt: op mobiel staat
// Support als item achter de hamburger i.p.v. als zwevende pil
// (`mobielInMenu` + `feedbackMenuTab` + `useFeedbackPad`), op desktop het
// verticale label rechts. Zie "Feedback-capture" in de CLAUDE.md van
// motrac-template-ui.
function HomeShell() {
  const { session, logout } = useAuth()
  const { t } = useTranslation('common')
  const isMobiel = useMobiel()
  // Op het support-pad blijft de pagina staan waar de gebruiker was terwijl de
  // widget opengaat (er is bewust géén <Route> voor dat pad).
  const { routesLocation } = useFeedbackPad()

  // Geef een tab een ECHT pad, nooit "/": NavLink markeert "/" alleen bij een
  // exacte match, dus een starttab op "/" licht niet op na een verversing.
  // Vandaar /start met een redirect vanaf /.
  const tabs: Tab[] = [
    { to: '/start', label: t('nav.home'), icon: 'home' },
    // Alleen op mobiel: daar vervangt dit menu-item de zwevende support-pil.
    ...(isMobiel ? [feedbackMenuTab(t('ui.feedback'))] : []),
  ]

  return (
    <>
      <AppShell
        title={t('app.titel')}
        subtitle={session?.user.naam}
        tabs={tabs}
        onLogout={logout}
        acties={<TaalKiezer />}
      >
        <Routes location={routesLocation}>
          <Route path="/" element={<Navigate to="/start" replace />} />
          <Route path="/start" element={<HomePage />} />
          <Route path="*" element={<Navigate to="/start" replace />} />
        </Routes>
      </AppShell>
      <FeedbackWidget verstuur={verstuurFeedback} mobielInMenu />
    </>
  )
}
