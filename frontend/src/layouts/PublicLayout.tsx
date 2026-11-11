import { useEffect } from 'react'
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom'

import { Navbar, type NavItem } from '@/components/Navbar'
import { SiteFooter } from '@/components/SiteFooter'
import { useAuth } from '@/context/AuthContext'
import { useCivicTheme } from '@/hooks/useCivicTheme'
import { roleHome } from '@/routes/roles'
import { cn } from '@/utils/cn'

export function PublicLayout() {
  useCivicTheme()
  const { status, role, user, logout, acknowledgeSignOut } = useAuth()
  const isLanding = useLocation().pathname === '/'
  // Landing here is where a user-initiated log out ends; from now on protected pages go to /login again.
  useEffect(() => acknowledgeSignOut(), [acknowledgeSignOut])
  const signedIn = status === 'authenticated'
  const items: NavItem[] = [
    { to: '/explore', label: 'Explore' },
    ...(signedIn
      ? [{ to: roleHome(role), label: 'My account', emphasis: 'primary' as const }]
      : [
          { to: '/login', label: 'Log in' },
          { to: '/register', label: 'Register', emphasis: 'brand' as const },
        ]),
  ]
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar items={items} userName={signedIn ? user?.full_name : undefined} onLogout={logout} />
      <ScrollRestoration />
      {/* the landing page paints edge to edge; every other page sits in a centred column */}
      <main className={cn('w-full flex-1', !isLanding && 'civic-enter mx-auto max-w-6xl px-4 py-8')}>
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
