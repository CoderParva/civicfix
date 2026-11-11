import { Inbox, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
  icon?: LucideIcon
  /** Tone of the icon chip (a status key or primary / success / warning / danger / neutral). */
  tone?: string
}

/** What you see when there is nothing to show: an icon, one line of why, and the next step. */
export function EmptyState({ title, description, action, icon: Icon = Inbox, tone = 'neutral' }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <span data-tone={tone} className="tone-chip flex size-12 items-center justify-center rounded-full border">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="type-heading">{title}</h3>
        {description && <p className="type-body max-w-md text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
