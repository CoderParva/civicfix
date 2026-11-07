import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { accountsApi, type RegisterPayload } from '@/services/accountsApi'
import { refreshAccessToken } from '@/services/apiClient'
import { configureAuth, getRefreshToken, setRefreshToken } from '@/services/authBridge'
import type { Role, User } from '@/types/api'
import { decodeJwt } from '@/utils/jwt'

type Status = 'loading' | 'authenticated' | 'unauthenticated'

interface Session {
  accessToken: string
  user: User
}

interface AuthContextValue {
  status: Status
  user: User | null
  /** From the JWT `role` claim (falls back to the profile). UX gating only. */
  role: Role | null
  /** True when the last sign-out was forced (refresh failed), not chosen. */
  sessionExpired: boolean
  /** True after the user pressed "Log out" (cleared on the next sign-in). */
  signedOutByUser: boolean
  login: (email: string, password: string) => Promise<User>
  register: (payload: RegisterPayload) => Promise<User>
  logout: () => void
  /** Called once a public page has rendered after a log out, so the flag does not linger. */
  acknowledgeSignOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<Status>(() => (getRefreshToken() ? 'loading' : 'unauthenticated'))
  const [sessionExpired, setSessionExpired] = useState(false)
  const [signedOutByUser, setSignedOutByUser] = useState(false)
  // The access token lives in memory only. The ref lets the axios interceptor read the latest
  // value synchronously, without waiting for a React render.
  const accessRef = useRef<string | null>(null)
  const bootstrapped = useRef(false)

  const clearSession = useCallback(() => {
    accessRef.current = null
    setRefreshToken(null)
    setSession(null)
    setStatus('unauthenticated')
    queryClient.clear() // never leave one user's cached data around for the next sign-in
  }, [queryClient])

  useLayoutEffect(() => {
    configureAuth({
      getAccessToken: () => accessRef.current,
      onTokensRefreshed: ({ access }) => {
        accessRef.current = access
        setSession((s) => (s ? { ...s, accessToken: access } : s))
      },
      onAuthFailure: () => {
        clearSession()
        setSessionExpired(true)
      },
    })
    return () => configureAuth(null)
  }, [clearSession])

  // Restore a session after a reload: trade the stored refresh token for a fresh access token.
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    if (!getRefreshToken()) return
    ;(async () => {
      try {
        const access = await refreshAccessToken()
        accessRef.current = access
        const user = await accountsApi.getProfile()
        setSession({ accessToken: access, user })
        setStatus('authenticated')
      } catch {
        clearSession()
      }
    })()
  }, [clearSession])

  const login = useCallback(async (email: string, password: string) => {
    const { access, refresh, user } = await accountsApi.login(email, password)
    accessRef.current = access
    setRefreshToken(refresh)
    setSession({ accessToken: access, user })
    setSessionExpired(false)
    setSignedOutByUser(false)
    setStatus('authenticated')
    return user
  }, [])

  const register = useCallback((payload: RegisterPayload) => accountsApi.register(payload), [])

  const logout = useCallback(() => {
    clearSession()
    setSessionExpired(false)
    setSignedOutByUser(true)
  }, [clearSession])

  const acknowledgeSignOut = useCallback(() => setSignedOutByUser(false), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      role: decodeJwt(session?.accessToken)?.role ?? session?.user.role ?? null,
      sessionExpired,
      signedOutByUser,
      login,
      register,
      logout,
      acknowledgeSignOut,
    }),
    [status, session, sessionExpired, signedOutByUser, login, register, logout, acknowledgeSignOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
