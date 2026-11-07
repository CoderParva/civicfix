import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/context/AuthContext'
import type { Role } from '@/types/api'

import { postLoginTarget, roleHome } from './roles'

function FullPageSpinner() {
  return (
    <div role="status" aria-label="Loading session" className="mx-auto flex max-w-md flex-col gap-3 p-8">
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

/**
 * UX gate only: it stops a signed-out user, or the wrong role, from seeing a screen. It is NOT
 * the security boundary. Every API call is authorised again by the Django permission classes.
 */
export function ProtectedRoute({ allowedRoles }: { allowedRoles: Role[] }) {
  const { status, role, sessionExpired, signedOutByUser } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner />
  if (status === 'unauthenticated') {
    // The user chose to log out: take them to the landing page, not a login wall.
    if (signedOutByUser) return <Navigate to="/" replace />
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search, expired: sessionExpired }} />
  }
  if (!role || !allowedRoles.includes(role)) return <Navigate to={roleHome(role)} replace />
  return <Outlet />
}

/** Login/register are for signed-out users; a signed-in user is sent to their home instead. */
export function GuestOnly() {
  const { status, role } = useAuth()
  const from = (useLocation().state as { from?: string } | null)?.from
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'authenticated') return <Navigate to={postLoginTarget(role, from)} replace />
  return <Outlet />
}
