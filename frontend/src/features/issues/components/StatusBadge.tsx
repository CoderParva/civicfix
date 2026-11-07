import { Badge } from '@/components/ui/badge'
import type { IssueStatus } from '@/types/api'
import { cn } from '@/utils/cn'

const STATUS: Record<IssueStatus, { label: string; className: string }> = {
  reported: { label: 'Reported', className: 'border-slate-300 bg-slate-100 text-slate-800' },
  under_review: { label: 'Under review', className: 'border-sky-300 bg-sky-100 text-sky-900' },
  assigned: { label: 'Assigned', className: 'border-indigo-300 bg-indigo-100 text-indigo-900' },
  in_progress: { label: 'In progress', className: 'border-amber-300 bg-amber-100 text-amber-900' },
  resolved: { label: 'Resolved', className: 'border-emerald-300 bg-emerald-100 text-emerald-900' },
  reopened: { label: 'Reopened', className: 'border-orange-300 bg-orange-100 text-orange-900' },
  rejected: { label: 'Rejected', className: 'border-rose-300 bg-rose-100 text-rose-900' },
}

export function StatusBadge({ status }: { status: IssueStatus }) {
  const { label, className } = STATUS[status] ?? { label: status, className: '' }
  return (
    <Badge variant="outline" className={cn(className)} data-status={status}>
      {label}
    </Badge>
  )
}
