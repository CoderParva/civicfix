import { useEffect } from 'react'
import { Outlet, ScrollRestoration } from 'react-router-dom'

import { Navbar, type NavItem } from '@/components/Navbar'
import { useAuth } from '@/context/AuthContext'
import { roleHome } from '@/routes/roles'

export function PublicLayout() {
  const { status, role, user, logout, acknowledgeSignOut } = useAuth()
  // Landing here is where a user-initiated log out ends; from now on protected pages go to /login again.
  useEffect(() => acknowledgeSignOut(), [acknowledgeSignOut])
  const signedIn = status === 'authenticated'
  const items: NavItem[] = [
    { to: '/explore', label: 'Explore' },
    ...(signedIn
      ? [{ to: roleHome(role), label: 'My account' }]
      : [
          { to: '/login', label: 'Log in' },
          { to: '/register', label: 'Register' },
        ]),
  ]
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar items={items} userName={signedIn ? user?.full_name : undefined} onLogout={logout} />
      <ScrollRestoration />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t py-4 text-center text-xs text-muted-foreground">CivicFix · report it, track it, get it fixed</footer>
    </div>
  )
}
