import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import {
  AuthProvider as MotracAuthProvider,
  useAuth as useMotracAuth,
  type MotracUser,
} from '@motrac/auth-client'
import { motracAuthClient } from '../lib/motracAuth'
import type { Role } from '../types'

// BESCHERMD (zie CLAUDE.md): dunne app-specifieke laag bovenop
// @motrac/auth-client. Dat pakket levert een rolagnostische sessie (user uit
// Motrac-beheer); hier wordt alleen de rol afgeleid. Login-, sessie- en
// SSO-logica hoort in het pakket en wordt hier niet nagebouwd.
//
// Vers scaffold zonder eigen rolmodel: de twee rollen hieronder zijn precies
// de twee standaard `app_rollen` die Motrac-beheer voor elke nieuwe app
// aanmaakt (gebruiker/admin).

export type LoginOutcome = { kind: 'success'; role: Role } | { kind: 'mustChangePassword' } | { kind: 'error'; message: string }

export type ChangePasswordOutcome = { kind: 'success'; role: Role } | { kind: 'error'; message: string }

const KNOWN_ROLES: Role[] = ['gebruiker', 'admin']

/** Ingelogde sessie. `user` is het volledige profiel uit Motrac-beheer. */
export interface Session {
  role: Role
  user: MotracUser
}

interface AuthContextValue {
  session: Session | null
  status: 'loading' | 'anonymous' | 'authenticated'
  sessionExpired: boolean
  login: (email: string, password: string) => Promise<LoginOutcome>
  changePassword: (email: string, currentPassword: string, newPassword: string) => Promise<ChangePasswordOutcome>
  logout: () => Promise<void>
  startSsoLogin: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Onbekende/lege rol valt terug op 'gebruiker' — least privilege: een account
// waarvan de rol in Motrac-beheer nog niet (goed) staat mag de app in, maar
// krijgt geen verhoogde rechten.
function toSession(user: MotracUser): Session {
  const rol = (user.rol ?? '').trim().toLowerCase()
  const role = (KNOWN_ROLES as string[]).includes(rol) ? (rol as Role) : 'gebruiker'
  return { role, user }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <MotracAuthProvider client={motracAuthClient}>
      <AuthBridge>{children}</AuthBridge>
    </MotracAuthProvider>
  )
}

function AuthBridge({ children }: { children: ReactNode }) {
  const core = useMotracAuth()
  const session = core.session ? toSession(core.session.user) : null

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const result = await core.login(email, password)
      if (result.kind === 'success') return { kind: 'success', role: toSession(result.user).role }
      return result
    },
    [core],
  )

  const changePassword = useCallback(
    async (email: string, currentPassword: string, newPassword: string): Promise<ChangePasswordOutcome> => {
      const result = await core.changePassword(email, currentPassword, newPassword)
      if (result.kind === 'success') return { kind: 'success', role: toSession(result.user).role }
      return result
    },
    [core],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      status: core.status,
      sessionExpired: core.sessionExpired,
      login,
      changePassword,
      logout: core.logout,
      startSsoLogin: core.startSsoLogin,
    }),
    [session, core.status, core.sessionExpired, login, changePassword, core.logout, core.startSsoLogin],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth moet binnen <AuthProvider> gebruikt worden')
  return ctx
}
