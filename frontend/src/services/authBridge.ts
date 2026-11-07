/**
 * The seam between the axios client (plain module code) and AuthContext (React state).
 *
 * - The ACCESS token lives only in memory, owned by AuthContext, and is read through here.
 * - The REFRESH token is the one thing that must survive a page reload, so it is kept in
 *   sessionStorage (per tab, gone when the tab closes). Trade-off: readable by injected
 *   script (XSS), unlike an httpOnly cookie; the backend currently returns it in the JSON body.
 */
const REFRESH_KEY = 'civicfix.refresh'

export interface AuthHandlers {
  getAccessToken: () => string | null
  /** Called after a successful refresh with the new (rotated) pair. */
  onTokensRefreshed: (tokens: { access: string; refresh: string }) => void
  /** Called when the session is unrecoverable: clear state, send the user to login. */
  onAuthFailure: () => void
}

let handlers: AuthHandlers | null = null

export function configureAuth(next: AuthHandlers | null) {
  handlers = next
}

export function getAuthHandlers(): AuthHandlers | null {
  return handlers
}

export function getRefreshToken(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_KEY)
  } catch {
    return null
  }
}

export function setRefreshToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(REFRESH_KEY, token)
    else sessionStorage.removeItem(REFRESH_KEY)
  } catch {
    /* storage blocked: the session just won't survive a reload */
  }
}
