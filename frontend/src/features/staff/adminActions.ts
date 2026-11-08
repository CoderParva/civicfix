import type { AdminIssue } from '@/types/staff'

export interface AdminActionPlan {
  /** Moderation: let it through (and start review). */
  approve: boolean
  reject: boolean
  /** Hand it to a department + officer. */
  assign: boolean
  reopen: boolean
  /** One line explaining the situation when nothing can be done. */
  note: string | null
}

/**
 * Which admin actions make sense for this issue. Mirrors the backend rules (approve: pending + still
 * REPORTED; reject: REPORTED or UNDER_REVIEW; assign: UNDER_REVIEW or REOPENED; reopen: RESOLVED), so
 * the UI only offers what the API will accept. The API still enforces every one of them.
 */
export function planAdminActions(issue: AdminIssue): AdminActionPlan {
  const approve = issue.moderation_status === 'pending' && issue.status === 'reported'
  const reject = issue.status === 'reported' || issue.status === 'under_review'
  const assign = issue.moderation_status === 'approved' && (issue.status === 'under_review' || issue.status === 'reopened')
  const reopen = issue.status === 'resolved'
  let note: string | null = null
  if (!approve && !reject && !assign && !reopen) {
    note =
      issue.status === 'rejected'
        ? 'This issue was rejected. That is final.'
        : issue.status === 'assigned'
          ? 'Waiting for the assigned officer to accept it.'
          : 'An officer is working on it. No admin action is needed.'
  }
  return { approve, reject, assign, reopen, note }
}
