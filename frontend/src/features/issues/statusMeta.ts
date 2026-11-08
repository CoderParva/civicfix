import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircleDashed,
  Eye,
  Flame,
  Loader2,
  Minus,
  RotateCcw,
  UserCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react'

import type { IssuePriority, IssueStatus } from '@/types/api'

export interface Meta<T extends string> {
  value: T
  label: string
  icon: LucideIcon
}

/**
 * One definition of what each status / priority looks like: label, icon, and (through
 * `data-tone={value}` in index.css) colour. Badges, the timeline, filters and charts all read from
 * here, so a status is the same icon and colour everywhere.
 */
export const STATUS_META: Record<IssueStatus, Meta<IssueStatus>> = {
  reported: { value: 'reported', label: 'Reported', icon: CircleDashed },
  under_review: { value: 'under_review', label: 'Under review', icon: Eye },
  assigned: { value: 'assigned', label: 'Assigned', icon: UserCheck },
  in_progress: { value: 'in_progress', label: 'In progress', icon: Loader2 },
  resolved: { value: 'resolved', label: 'Resolved', icon: CheckCircle2 },
  reopened: { value: 'reopened', label: 'Reopened', icon: RotateCcw },
  rejected: { value: 'rejected', label: 'Rejected', icon: XCircle },
}

export const PRIORITY_META: Record<IssuePriority, Meta<IssuePriority>> = {
  low: { value: 'low', label: 'Low', icon: ArrowDown },
  medium: { value: 'medium', label: 'Medium', icon: Minus },
  high: { value: 'high', label: 'High', icon: ArrowUp },
  critical: { value: 'critical', label: 'Critical', icon: Flame },
}

/** The happy path an issue is expected to follow (rejected / reopened are detours from it). */
export const LIFECYCLE: IssueStatus[] = ['reported', 'under_review', 'assigned', 'in_progress', 'resolved']

export const statusLabel = (status: string): string => STATUS_META[status as IssueStatus]?.label ?? status
