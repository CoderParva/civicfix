import type { Role } from '@/types/api'

/** Where each role lands after signing in. */
export function roleHome(role: Role | null): string {
  if (role === 'officer') return '/officer'
  if (role === 'admin') return '/admin'
  return '/dashboard'
}

/** The URL prefix a role's workspace lives under, or null for citizens (their pages have no common prefix). */
const AREA: Record<Role, string | null> = { citizen: null, officer: '/officer', admin: '/admin' }

function canOpen(role: Role, path: string): boolean {
  const area = AREA[role]
  if (area) return path === area || path.startsWith(`${area}/`)
  return !path.startsWith('/officer') && !path.startsWith('/admin') // citizens: everything outside the staff areas
}

/**
 * Where to go right after signing in: back to the page the visitor was trying to open, but only if
 * it is a same-origin path this role is allowed to see; otherwise the role's home. Used by BOTH the
 * login page and GuestOnly, so the two can never disagree about the destination.
 */
export function postLoginTarget(role: Role | null, from?: string): string {
  if (role && from && from.startsWith('/') && !from.startsWith('//') && canOpen(role, from)) return from
  return roleHome(role)
}
