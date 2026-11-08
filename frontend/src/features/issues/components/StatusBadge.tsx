import type { IssueStatus } from '@/types/api'
import { cn } from '@/utils/cn'

import { STATUS_META } from '../statusMeta'

/** Icon + label, coloured by the status tone. Never colour alone, so it reads without colour vision. */
export function StatusBadge({ status, className }: { status: IssueStatus; className?: string }) {
  const meta = STATUS_META[status]
  const Icon = meta?.icon
  return (
    <span
      data-tone={status}
      data-status={status}
      className={cn(
        'tone-chip inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap',
        className,
      )}
    >
      {Icon && <Icon aria-hidden className={cn('size-3.5', status === 'in_progress' && 'motion-safe:animate-spin [animation-duration:2.4s]')} />}
      {meta?.label ?? status}
    </span>
  )
}
