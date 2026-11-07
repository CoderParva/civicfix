import { Outlet } from 'react-router-dom'

import { Navbar, type NavItem } from '@/components/Navbar'
import { useAuth } from '@/context/AuthContext'

const ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/my-reports', label: 'My reports' },
  { to: '/report', label: 'Report an issue' },
]

export function CitizenLayout() {
  const { user, logout } = useAuth()
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar
        items={ITEMS}
        homeTo="/dashboard"
        userName={user?.full_name}
        onLogout={logout}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
