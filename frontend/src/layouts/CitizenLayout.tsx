import { Outlet, ScrollRestoration } from 'react-router-dom'

import { Navbar, type NavItem } from '@/components/Navbar'
import { SiteFooter } from '@/components/SiteFooter'
import { useAuth } from '@/context/AuthContext'
import { useCivicTheme } from '@/hooks/useCivicTheme'

const ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/my-reports', label: 'My reports' },
  { to: '/explore', label: 'Explore' },
  { to: '/report', label: 'Report an issue', emphasis: 'brand' },
]

export function CitizenLayout() {
  useCivicTheme()
  const { user, logout } = useAuth()
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar
        items={ITEMS}
        homeTo="/dashboard"
        userName={user?.full_name}
        onLogout={logout}
      />
      <ScrollRestoration />
      <main className="civic-enter mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
