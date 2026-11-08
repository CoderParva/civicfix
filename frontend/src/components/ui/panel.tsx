import type * as React from 'react'

import { cn } from '@/utils/cn'

/** The one surface: 12px radius, hairline border, resting shadow. Cards, tables and charts sit on it. */
export function Panel({ className, ...props }: React.ComponentProps<'section'>) {
  return <section data-slot="panel" className={cn('rounded-xl border bg-surface shadow-xs', className)} {...props} />
}

interface PanelHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export function PanelHeader({ title, description, actions, className }: PanelHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-4 px-6 pt-6', className)}>
      <div className="min-w-0">
        <h2 className="type-heading text-foreground">{title}</h2>
        {description && <p className="type-caption mt-1">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function PanelBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-6', className)} {...props} />
}
