import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { Button, Card, ErrorText, Field, Input, ThemeToggle } from '@motrac/template-ui'
import type { Role } from '../../types'

interface ChangePasswordPageProps {
  email: string
  currentPassword: string
  onDone: (role: Role) => void
  onBack: () => void
}

const MIN_LENGTH = 10

// Verplichte wachtwoordwijziging na een eerste login met een tijdelijk
// wachtwoord (Motrac-beheer: 403 PASSWORD_CHANGE_REQUIRED). Zelfde visuele
// stijl als LoginPage.
export function ChangePasswordPage({ email, currentPassword, onDone, onBack }: ChangePasswordPageProps) {
  const { t } = useTranslation(['auth', 'common'])
  const { changePassword } = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const valid = newPassword.length >= MIN_LENGTH && newPassword === repeat

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    const res = await changePassword(email, currentPassword, newPassword)
    setBusy(false)
    if (res.kind === 'success') onDone(res.role)
    else setError(res.message)
  }

  return (
    <div className="login">
      <div className="theme-fab">
        <ThemeToggle />
      </div>
      <div className="brand">
        <img className="brand-logo" src="/motrac-logo.svg" alt="Motrac – Linde Material Handling" />
        <div>
          <div className="brand-name">{t('wachtwoordWijzigen')}</div>
          <div className="brand-sub">{t('wachtwoordWijzigenSub')}</div>
        </div>
      </div>

      <Card>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label={t('nieuwWachtwoord', { min: MIN_LENGTH })}>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
          </Field>
          <Field label={t('herhaalWachtwoord')}>
            <Input
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {repeat.length > 0 && newPassword !== repeat && (
            <ErrorText>{t('wachtwoordenOngelijk')}</ErrorText>
          )}
          {error && <ErrorText>{error}</ErrorText>}
          <Button variant="primary" block type="submit" disabled={!valid || busy}>
            {busy ? t('common:algemeen.bezig') : t('instellenEnInloggen')}
          </Button>
          <button type="button" onClick={onBack} className="login-sso">
            {t('terugNaarInloggen')}
          </button>
        </form>
      </Card>
    </div>
  )
}
