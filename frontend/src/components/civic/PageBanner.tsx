import type { ReactNode } from 'react'

import { cn } from '@/utils/cn'

interface PageBannerProps {
  /** The page's one h1. */
  title: ReactNode
  description?: ReactNode
  /** Buttons on the right (or below, on a phone). */
  actions?: ReactNode
  className?: string
  children?: ReactNode
}

/** The coloured header block at the top of the citizen pages. */
export function PageBanner({ title, description, actions, className, children }: PageBannerProps) {
  return (
    <header className={cn('civic-banner flex flex-col gap-6 rounded-3xl p-6 sm:p-8', className)}>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="relative flex min-w-0 max-w-2xl flex-col gap-2">
          <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight text-balance sm:text-4xl">{title}</h1>
          {description && <p className="civic-banner-muted text-base sm:text-lg">{description}</p>}
        </div>
        {actions && <div className="relative flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {children}
    </header>
  )
}
