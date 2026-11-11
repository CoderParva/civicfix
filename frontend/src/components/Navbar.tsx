import { MapPinned } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'

import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/utils/cn'

export interface NavItem {
  to: string
  label: string
  /** Draw this link as a button: "brand" (saffron) is the one main action, "primary" a secondary one. */
  emphasis?: 'brand' | 'primary'
}

interface NavbarProps {
  items: NavItem[]
  /** Display name of the signed-in user; omit when signed out. */
  userName?: string
  onLogout?: () => void
  /** Where the logo points. */
  homeTo?: string
}

/** Pure presentational navbar: the layout decides what links and user to show. */
export function Navbar({ items, userName, onLogout, homeTo = '/' }: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 md:gap-x-5">
        <Link to={homeTo} className="group order-1 flex items-center gap-2.5 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-deep text-primary-foreground shadow-md transition-transform duration-200 group-hover:-rotate-6 group-hover:scale-105"
          >
            <MapPinned className="size-5" />
          </span>
          <span className="font-display text-xl font-extrabold tracking-tight text-foreground">CivicFix</span>
        </Link>
        {/* on a phone the links get their own row under the logo and scroll sideways rather than wrapping */}
        <ul className="order-3 -mx-1 flex w-full items-center gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:order-2 md:mx-0 md:w-auto md:flex-1 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
          {items.map((item) => (
            <li key={item.to} className={cn('shrink-0', item.emphasis && 'ml-1')}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  item.emphasis
                    ? cn(buttonVariants({ variant: item.emphasis === 'brand' ? 'brand' : 'default', size: 'sm' }), 'h-9 rounded-full px-4')
                    : cn(
                        'inline-flex h-9 items-center rounded-full px-3.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                        isActive && 'bg-primary-soft font-semibold text-primary',
                      )
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        {userName && (
          <div className="order-2 ml-auto flex items-center gap-2 sm:gap-3 md:order-3 md:ml-0">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                {userName.trim().charAt(0).toUpperCase()}
              </span>
              <span data-testid="nav-user" className="max-w-20 truncate sm:max-w-none">
                {userName}
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={onLogout} className="rounded-full">
              Log out
            </Button>
          </div>
        )}
      </nav>
    </header>
  )
}
