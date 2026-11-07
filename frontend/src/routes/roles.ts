import type { Role } from '@/types/api'

/** Where each role lands after signing in. Officer/admin screens arrive in a later phase. */
export function roleHome(role: Role | null): string {
  return role === 'citizen' ? '/dashboard' : '/coming-soon'
}

/**
 * Where to go right after signing in: back to the page the visitor was trying to open (citizens
 * only, same-origin paths only), otherwise the role's home. Used by BOTH the login page and
 * GuestOnly, so the two can never disagree about the destination.
 */
export function postLoginTarget(role: Role | null, from?: string): string {
  if (role === 'citizen' && from && from.startsWith('/') && !from.startsWith('//')) return from
  return roleHome(role)
}
