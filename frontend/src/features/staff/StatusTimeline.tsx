import { STATUS_META } from '@/features/issues/statusMeta'
import type { Role } from '@/types/api'
import type { StatusHistoryEntry } from '@/types/staff'
import { cn } from '@/utils/cn'
import { elapsedBetween, formatDateTime, formatRelative } from '@/utils/format'

const ROLE_LABEL: Record<Role, string> = { citizen: 'Citizen', officer: 'Officer', admin: 'Admin' }

/**
 * The full trail of an issue, oldest first, as a vertical timeline: a coloured node per status
 * change, who did it and why, when, and how long it took since the previous step. The last node is
 * the current state.
 */
export function StatusTimeline({ history }: { history: StatusHistoryEntry[] }) {
  if (history.length === 0) return <p className="type-body text-muted-foreground">No activity recorded yet.</p>
  return (
    <ol aria-label="Status history" className="flex flex-col">
      {history.map((entry, index) => {
        const meta = STATUS_META[entry.new_status]
        const Icon = meta.icon
        const last = index === history.length - 1
        const previous = history[index - 1]
        return (
          <li key={entry.id} data-tone={entry.new_status} className="relative flex gap-4 pb-8 last:pb-0">
            {!last && <span aria-hidden className="absolute top-8 bottom-0 left-4 w-px -translate-x-1/2 bg-border" />}
            <span
              className={cn(
                'relative flex size-8 shrink-0 items-center justify-center rounded-full border',
                last ? 'tone-dot border-transparent text-white ring-4 ring-[color-mix(in_oklab,var(--tone)_18%,transparent)]' : 'tone-chip',
              )}
            >
              <Icon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="type-body font-medium text-foreground">{meta.label}</p>
                {last && <span className="tone-chip type-caption rounded-full border px-2 font-medium">Current</span>}
              </div>
              <p className="type-caption mt-1">
                {entry.changed_by ? `${entry.changed_by.name} · ${ROLE_LABEL[entry.changed_by.role]}` : 'Former user'}
              </p>
              {entry.reason && <p className="type-body mt-2 text-muted-foreground">{entry.reason}</p>}
              <p className="type-caption mt-2 flex flex-wrap items-center gap-x-2">
                <time dateTime={entry.created_at} title={formatRelative(entry.created_at)}>
                  {formatDateTime(entry.created_at)}
                </time>
                {previous && <span>· {elapsedBetween(previous.created_at, entry.created_at)} after the previous step</span>}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
