import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export interface Crumb {
  label: string
  to?: string
}

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  breadcrumbs?: Crumb[]
  /** Badges / meta shown on the line under the title (status, priority, reference...). */
  meta?: ReactNode
}

export function PageHeader({ title, description, actions, breadcrumbs, meta }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="type-caption flex items-center gap-1">
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.label} className="flex items-center gap-1">
              {index > 0 && <ChevronRight aria-hidden className="size-3.5" />}
              {crumb.to ? (
                <Link to={crumb.to} className="rounded-sm transition-colors hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-foreground">
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="type-display text-balance text-foreground">{title}</h1>
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
          {description && <p className="type-body mt-2 max-w-2xl text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
