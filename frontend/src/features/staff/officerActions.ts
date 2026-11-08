import type { OfficerIssue } from '@/types/staff'

export type OfficerActionPlan =
  | { kind: 'accept' } // accept or send back
  | { kind: 'resolve' }
  | { kind: 'none'; message: string }

/**
 * What the officer can do with this issue right now. Mirrors the backend rules (only the assigned
 * officer acts; accept/reject only while ASSIGNED+pending; resolve only IN_PROGRESS) so the UI offers
 * exactly what the API will allow. The API still enforces all of it.
 */
export function planOfficerActions(issue: OfficerIssue): OfficerActionPlan {
  const assignment = issue.assignment
  if (!assignment) return { kind: 'none', message: 'This issue is no longer in your department’s queue.' }
  if (!assignment.is_mine) return { kind: 'none', message: `Assigned to ${assignment.officer.name}. Only they can act on it; you can still add notes.` }
  if (issue.status === 'assigned' && assignment.status === 'pending') return { kind: 'accept' }
  if (issue.status === 'in_progress') return { kind: 'resolve' }
  if (issue.status === 'resolved') return { kind: 'none', message: 'Resolved. If the problem comes back, an admin can reopen it.' }
  if (issue.status === 'under_review' || issue.status === 'reopened') return { kind: 'none', message: 'Back with the admin for review and reassignment.' }
  return { kind: 'none', message: 'No action is needed from you right now.' }
}
