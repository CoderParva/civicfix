import { CheckCircle2, ClipboardList, Hourglass, Wrench, type LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'

import type { IssueStats } from '../tally'

const ITEMS: { key: keyof Omit<IssueStats, 'rejected'>; label: string; hint: string; icon: LucideIcon; color: string }[] = [
  { key: 'total', label: 'Total reports', hint: 'Everything you have reported', icon: ClipboardList, color: 'oklch(0.5 0.235 268)' },
  { key: 'pending', label: 'Pending', hint: 'Waiting to be reviewed or started', icon: Hourglass, color: 'oklch(0.72 0.17 65)' },
  { key: 'inProgress', label: 'In progress', hint: 'An officer is working on it', icon: Wrench, color: 'oklch(0.62 0.15 225)' },
  { key: 'resolved', label: 'Resolved', hint: 'Fixed and closed out', icon: CheckCircle2, color: 'oklch(0.6 0.16 155)' },
]

export function StatsGrid({ stats }: { stats: IssueStats }) {
  return (
    <section aria-label="Report statistics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {ITEMS.map(({ key, label, hint, icon: Icon, color }) => (
        <Card
          key={key}
          data-testid={`stat-${key}`}
          style={{ '--cat': color } as CSSProperties}
          className="civic-lift relative overflow-hidden border-2 border-[color-mix(in_oklab,var(--cat)_22%,white)] bg-[color-mix(in_oklab,var(--cat)_7%,white)]"
        >
          <span aria-hidden className="absolute -top-8 -right-8 size-28 rounded-full bg-[color-mix(in_oklab,var(--cat)_16%,transparent)]" />
          <CardHeader className="relative">
            <span aria-hidden className="cat-icon mb-1 size-11 rounded-2xl">
              <Icon className="size-5" />
            </span>
            <CardDescription className="font-semibold text-foreground/70">{label}</CardDescription>
            <p className="font-display text-5xl leading-none font-extrabold tracking-tight tabular-nums" aria-label={`${label}: ${stats[key]}`}>
              {stats[key]}
            </p>
          </CardHeader>
          <CardContent className="relative text-xs text-muted-foreground">{hint}</CardContent>
        </Card>
      ))}
    </section>
  )
}
