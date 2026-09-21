import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { Button, Card, ErrorText, Field, Input, ThemeToggle } from '@motrac/template-ui'
import { ChangePasswordPage } from './ChangePasswordPage'
import type { Role } from '../../types'

// Loginscherm: één e-mail+wachtwoord-formulier tegen de centrale login van
// Motrac-beheer, plus de SSO-knop. Overgenomen uit mit-salessupport (de
// norm-app). Elke rol landt op dezelfde startpagina; goHome() bestaat zodat
// rolspecifieke navigatie hier later één plek heeft om aan te haken.
export function LoginPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['auth', 'common'])
  const { login, sessionExpired, startSsoLogin } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  function goHome(_role: Role) {
    navigate('/', { replace: true })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await login(email.trim().toLowerCase(), password)
    setBusy(false)
    if (res.kind === 'success') goHome(res.role)
    else if (res.kind === 'mustChangePassword') setChangingPassword(true)
    else setError(res.message)
  }

  if (changingPassword) {
    return (
      <ChangePasswordPage
        email={email.trim().toLowerCase()}
        currentPassword={password}
        onDone={goHome}
        onBack={() => setChangingPassword(false)}
      />
    )
  }

  return (
    <div className="login">
      <div className="theme-fab">
        <ThemeToggle />
      </div>
      <div className="brand">
        <img className="brand-logo" src="/motrac-logo.svg" alt="Motrac – Linde Material Handling" />
        <div>
          <div className="brand-name">{t('common:app.titel')}</div>
          <div className="brand-sub">{t('sub')}</div>
        </div>
      </div>

      <Card>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Input uit het pakket en geen kale <input>: die leest id/aria uit de
              omringende Field (FRONTEND_STANDARDS: fouten programmatisch aan het
              veld koppelen). */}
          <Field label={t('email')}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voornaam@motrac.nl"
              autoComplete="username"
              autoFocus
            />
          </Field>
          <Field label={t('wachtwoord')}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
          {!error && sessionExpired && <ErrorText>{t('sessieVerlopen')}</ErrorText>}
          <Button variant="primary" block type="submit" disabled={busy}>
            {busy ? t('common:algemeen.bezig') : t('inloggen')}
          </Button>
        </form>
        <button type="button" className="login-sso" onClick={startSsoLogin} disabled={busy}>
          {t('inloggenSso')}
        </button>
      </Card>
    </div>
  )
}
