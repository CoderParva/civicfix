import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/utils/cn'

interface StatTileProps {
  label: string
  value: ReactNode
  icon: LucideIcon
  /** Colour tone (a status or priority key, or primary / success / warning / danger / neutral). */
  tone?: string
  hint?: ReactNode
  /** Draws attention: a tinted surface. Use for "needs you" numbers only. */
  attention?: boolean
  /** Makes the whole tile a link. */
  to?: string
  loading?: boolean
  testId?: string
}

export function StatTile({ label, value, icon: Icon, tone = 'neutral', hint, attention, to, loading, testId }: StatTileProps) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span data-tone={tone} className="tone-chip flex size-8 items-center justify-center rounded-md border">
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="type-body font-medium text-muted-foreground">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-10 w-20" />
      ) : (
        <p className="type-stat text-foreground" aria-label={`${label}: ${value}`}>
          {value}
        </p>
      )}
      <div className="type-caption min-h-4">{loading ? <Skeleton className="h-4 w-32" /> : hint}</div>
    </>
  )
  const className = cn(
    'group flex flex-col gap-2 rounded-xl border bg-surface p-6 shadow-xs transition-[box-shadow,transform,border-color] duration-150',
    attention && 'border-[color-mix(in_oklab,var(--tone)_35%,white)] bg-[color-mix(in_oklab,var(--tone)_5%,white)]',
    to && 'hover:-translate-y-px hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
  )
  return to ? (
    <Link to={to} data-tone={tone} data-testid={testId} className={className}>
      {body}
    </Link>
  ) : (
    <div data-tone={tone} data-testid={testId} className={className}>
      {body}
    </div>
  )
}
