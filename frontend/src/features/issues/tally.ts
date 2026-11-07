import type { Issue, IssueStatus } from '@/types/api'

export interface IssueStats {
  total: number
  /** Waiting for someone to act: reported, under review, assigned (not yet accepted), reopened. */
  pending: number
  inProgress: number
  resolved: number
  /** Not one of the three headline buckets, so total can exceed pending + inProgress + resolved. */
  rejected: number
}

const PENDING: ReadonlySet<IssueStatus> = new Set(['reported', 'under_review', 'assigned', 'reopened'])

/**
 * The backend has no stats endpoint, so the dashboard counts the issues it fetched.
 * Pure function of the list: no hardcoded numbers anywhere.
 */
export function computeStats(issues: readonly Issue[]): IssueStats {
  const stats: IssueStats = { total: issues.length, pending: 0, inProgress: 0, resolved: 0, rejected: 0 }
  for (const { status } of issues) {
    if (PENDING.has(status)) stats.pending++
    else if (status === 'in_progress') stats.inProgress++
    else if (status === 'resolved') stats.resolved++
    else if (status === 'rejected') stats.rejected++
  }
  return stats
}
