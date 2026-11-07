import { Link, NavLink } from 'react-router-dom'

import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/utils/cn'

export interface NavItem {
  to: string
  label: string
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
    <header className="border-b bg-background">
      <nav aria-label="Main" className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link to={homeTo} className="text-lg font-bold tracking-tight text-primary">
          CivicFix
        </Link>
        <ul className="flex flex-1 flex-wrap items-center gap-1">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(buttonVariants({ variant: 'ghost', size: 'sm' }), isActive && 'bg-accent font-semibold')
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        {userName && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground" data-testid="nav-user">
              {userName}
            </span>
            <Button variant="outline" size="sm" onClick={onLogout}>
              Log out
            </Button>
          </div>
        )}
      </nav>
    </header>
  )
}
