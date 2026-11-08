import type { IssuePriority } from '@/types/api'
import { cn } from '@/utils/cn'

import { PRIORITY_META } from '../statusMeta'

/**
 * `label` shows the long form ("Medium priority") used on citizen pages; the staff tables use the
 * compact form ("Medium") because the column header already says Priority.
 */
export function PriorityBadge({ priority, compact = false, className }: { priority: IssuePriority; compact?: boolean; className?: string }) {
  const meta = PRIORITY_META[priority]
  const Icon = meta?.icon
  return (
    <span
      data-tone={priority}
      data-priority={priority}
      className={cn(
        'tone-chip inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap',
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {meta ? (priority === 'critical' || compact ? meta.label : `${meta.label} priority`) : priority}
    </span>
  )
}
