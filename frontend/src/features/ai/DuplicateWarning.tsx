import { ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatusBadge } from '@/features/issues/components/StatusBadge'
import type { DuplicateMatch } from '@/types/ai'
import { formatRelative } from '@/utils/format'

interface DuplicateWarningProps {
  /** The matches to show; the dialog is open exactly when there are some. */
  matches: DuplicateMatch[] | null
  submitting: boolean
  onSubmitAnyway: () => void
  onDismiss: () => void
}

const metres = (m: number) => (m < 20 ? 'right here' : `${Math.round(m / 10) * 10} m away`)

/**
 * Shown between "Submit" and the report actually being sent when something similar is already reported
 * nearby. It informs, it never blocks: "Submit anyway" always goes through, and each match opens the
 * existing report (where the person can vote for it instead).
 */
export function DuplicateWarning({ matches, submitting, onSubmitAnyway, onDismiss }: DuplicateWarningProps) {
  return (
    <Dialog open={matches !== null && matches.length > 0} onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This looks like something already reported</DialogTitle>
          <DialogDescription>
            {matches?.length === 1 ? 'A report' : 'Reports'} near this spot may be the same problem. If it is, open it and
            vote for it, so it is not handled twice. If yours is different, submit it anyway.
          </DialogDescription>
        </DialogHeader>
        <ul aria-label="Similar reports" className="flex flex-col gap-3">
          {matches?.map((match) => (
            <li key={match.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <a
                  href={`/issues/${match.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="type-body inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  {match.title}
                  <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                <span
                  data-likelihood={match.likelihood}
                  className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium"
                >
                  {match.likelihood === 'likely' ? 'Very similar' : 'Possibly the same'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <StatusBadge status={match.status} />
                <span>{match.category.name}</span>
                <span>{metres(match.distance_m)}</span>
                <span>reported {formatRelative(match.reported_at)}</span>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss}>
            Go back and edit
          </Button>
          <Button onClick={onSubmitAnyway} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit anyway'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
