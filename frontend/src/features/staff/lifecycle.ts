import { LIFECYCLE } from '@/features/issues/statusMeta'
import type { IssueStatus } from '@/types/api'

export type StepState = 'done' | 'current' | 'upcoming'

export interface Step {
  status: IssueStatus
  /** What the step is called (a reopened issue shows "Reopened" at the review step). */
  label: IssueStatus
  state: StepState
}

/**
 * The steps of the stepper for an issue's current status.
 *
 * The normal path is reported -> under review -> assigned -> in progress -> resolved. The two
 * detours are drawn honestly rather than hidden: REJECTED ends the path early on a red step, and
 * REOPENED puts an orange step where review resumes (the work has to be redone from there).
 */
export function buildSteps(status: IssueStatus): Step[] {
  if (status === 'rejected') {
    return [
      { status: 'reported', label: 'reported', state: 'done' },
      { status: 'rejected', label: 'rejected', state: 'current' },
    ]
  }
  const index = status === 'reopened' ? LIFECYCLE.indexOf('under_review') : LIFECYCLE.indexOf(status)
  return LIFECYCLE.map((step, i) => ({
    status: step,
    label: status === 'reopened' && i === index ? 'reopened' : step,
    state: i < index ? 'done' : i === index ? 'current' : 'upcoming',
  }))
}
