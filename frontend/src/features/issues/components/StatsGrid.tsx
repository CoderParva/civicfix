import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'

import type { IssueStats } from '../tally'

const ITEMS: { key: keyof Omit<IssueStats, 'rejected'>; label: string; hint: string }[] = [
  { key: 'total', label: 'Total reports', hint: 'Everything you have reported' },
  { key: 'pending', label: 'Pending', hint: 'Waiting to be reviewed or started' },
  { key: 'inProgress', label: 'In progress', hint: 'An officer is working on it' },
  { key: 'resolved', label: 'Resolved', hint: 'Fixed and closed out' },
]

export function StatsGrid({ stats }: { stats: IssueStats }) {
  return (
    <section aria-label="Report statistics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {ITEMS.map(({ key, label, hint }) => (
        <Card key={key} data-testid={`stat-${key}`}>
          <CardHeader>
            <CardDescription>{label}</CardDescription>
            <p className="text-3xl font-bold tabular-nums" aria-label={`${label}: ${stats[key]}`}>
              {stats[key]}
            </p>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>
        </Card>
      ))}
    </section>
  )
}
