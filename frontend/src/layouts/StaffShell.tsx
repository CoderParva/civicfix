import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ExternalLink, LogOut, MapPinned, Menu } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router-dom'

import { Avatar } from '@/components/Avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/utils/cn'

export interface StaffNavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Match the path exactly (for the workspace's index route). */
  end?: boolean
}

interface StaffShellProps {
  items: StaffNavItem[]
  /** "Officer workspace" / "Admin console" */
  workspace: string
}

function Brand({ workspace }: { workspace: string }) {
  return (
    <div className="flex items-center gap-2 px-2">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
        <MapPinned aria-hidden className="size-4" />
      </span>
      <div className="leading-tight">
        <p className="type-heading">CivicFix</p>
        <p className="type-overline">{workspace}</p>
      </div>
    </div>
  )
}

function SidebarBody({ items, workspace, onNavigate }: StaffShellProps & { onNavigate?: () => void }) {
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="flex h-full flex-col gap-8 p-4">
      <div className="pt-2">
        <Brand workspace={workspace} />
      </div>
      <nav aria-label="Workspace" className="flex flex-col gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'type-body group flex h-10 items-center gap-3 rounded-md px-3 font-medium transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-subtle hover:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon aria-hidden className={cn('size-4 transition-colors', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-2">
        <NavLink
          to="/explore"
          onClick={onNavigate}
          className="type-body flex h-10 items-center gap-3 rounded-md px-3 font-medium text-muted-foreground transition-colors duration-150 hover:bg-subtle hover:text-foreground"
        >
          <ExternalLink aria-hidden className="size-4" />
          Public site
        </NavLink>
        <div className="flex items-center gap-2 rounded-xl border bg-subtle p-2">
          <Avatar name={user?.full_name ?? ''} />
          <div className="min-w-0 flex-1 leading-tight">
            <p data-testid="nav-user" className="type-body truncate font-medium">
              {user?.full_name}
            </p>
            <p className="type-caption capitalize">{role}</p>
          </div>
          <button
            type="button"
            aria-label="Log out"
            onClick={() => {
              logout()
              navigate('/', { replace: true })
            }}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <LogOut aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function PageFallback(): ReactNode {
  return (
    <div role="status" aria-label="Loading page" className="flex flex-col gap-6">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}

/**
 * The staff workspace frame: a fixed 256px sidebar on desktop, a slide-over on mobile, and a
 * centred content column on the canvas. Pages render into <Outlet/> (lazily, with a skeleton).
 */
export function StaffShell({ items, workspace }: StaffShellProps) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setOpen(false), [location.pathname])

  return (
    <div className="min-h-screen bg-canvas lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r bg-surface lg:block">
        <SidebarBody items={items} workspace={workspace} />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-surface/90 px-4 backdrop-blur lg:hidden">
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Trigger
            aria-label="Open navigation"
            className="flex size-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <Menu aria-hidden className="size-5" />
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="animate-fade fixed inset-0 z-40 bg-foreground/30" />
            <DialogPrimitive.Content className="animate-fade fixed inset-y-0 left-0 z-50 w-64 border-r bg-surface shadow-lg outline-none">
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">Workspace sections</DialogPrimitive.Description>
              <SidebarBody items={items} workspace={workspace} onNavigate={() => setOpen(false)} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
        <p className="type-heading">CivicFix</p>
        <span className="type-overline">{workspace}</span>
      </header>

      <ScrollRestoration />
      <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8 sm:py-10">
        <Suspense fallback={<PageFallback />}>
          <div key={location.pathname} className="animate-rise">
            <Outlet />
          </div>
        </Suspense>
      </main>
    </div>
  )
}
