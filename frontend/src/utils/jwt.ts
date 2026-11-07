import type { Role } from '@/types/api'

export interface AccessClaims {
  role?: Role
  email?: string
  user_id?: string
  exp?: number
}

/**
 * Decode (NOT verify) a JWT payload. The role claim is only used to pick which screens to show;
 * the backend re-checks every request, so a forged token here gains nothing but a broken UI.
 */
export function decodeJwt(token: string | null | undefined): AccessClaims | null {
  if (!token) return null
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    return JSON.parse(json) as AccessClaims
  } catch {
    return null
  }
}
