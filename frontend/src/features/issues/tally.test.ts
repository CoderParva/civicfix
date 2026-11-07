import { describe, expect, it } from 'vitest'

import { makeIssue } from '@/test/factories'
import type { IssueStatus } from '@/types/api'

import { computeStats } from './tally'

const issuesWith = (...statuses: IssueStatus[]) => statuses.map((status) => makeIssue({ status }))

describe('computeStats', () => {
  it('is all zeros for no issues (no invented numbers)', () => {
    expect(computeStats([])).toEqual({ total: 0, pending: 0, inProgress: 0, resolved: 0, rejected: 0 })
  })

  it('tallies each status into the right bucket', () => {
    const stats = computeStats(
      issuesWith('reported', 'reported', 'under_review', 'assigned', 'reopened', 'in_progress', 'in_progress', 'resolved', 'rejected'),
    )
    expect(stats).toEqual({ total: 9, pending: 5, inProgress: 2, resolved: 1, rejected: 1 })
  })

  it.each<[IssueStatus, keyof ReturnType<typeof computeStats>]>([
    ['reported', 'pending'],
    ['under_review', 'pending'],
    ['assigned', 'pending'],
    ['reopened', 'pending'],
    ['in_progress', 'inProgress'],
    ['resolved', 'resolved'],
    ['rejected', 'rejected'],
  ])('counts a single %s issue under %s', (status, bucket) => {
    const stats = computeStats(issuesWith(status))
    expect(stats.total).toBe(1)
    expect(stats[bucket]).toBe(1)
    const others = Object.entries(stats).filter(([k]) => k !== 'total' && k !== bucket)
    expect(others.every(([, v]) => v === 0)).toBe(true)
  })

  it('every backend status lands in exactly one bucket (nothing silently dropped)', () => {
    const all: IssueStatus[] = ['reported', 'under_review', 'assigned', 'in_progress', 'resolved', 'reopened', 'rejected']
    const { total, pending, inProgress, resolved, rejected } = computeStats(issuesWith(...all))
    expect(pending + inProgress + resolved + rejected).toBe(total)
  })

  it('does not mutate its input', () => {
    const issues = issuesWith('resolved', 'reported')
    const copy = structuredClone(issues)
    computeStats(issues)
    expect(issues).toEqual(copy)
  })
})
