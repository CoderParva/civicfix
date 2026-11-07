import { Badge } from '@/components/ui/badge'
import type { IssuePriority } from '@/types/api'
import { cn } from '@/utils/cn'

const PRIORITY: Record<IssuePriority, { label: string; className: string }> = {
  low: { label: 'Low priority', className: 'border-slate-300 text-slate-700' },
  medium: { label: 'Medium priority', className: 'border-sky-300 text-sky-800' },
  high: { label: 'High priority', className: 'border-orange-300 text-orange-800' },
  critical: { label: 'Critical', className: 'border-red-400 bg-red-50 text-red-800' },
}

export function PriorityBadge({ priority }: { priority: IssuePriority }) {
  const { label, className } = PRIORITY[priority] ?? { label: priority, className: '' }
  return (
    <Badge variant="outline" className={cn(className)} data-priority={priority}>
      {label}
    </Badge>
  )
}
