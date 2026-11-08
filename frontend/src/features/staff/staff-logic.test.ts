import { describe, expect, it } from 'vitest'

import { LIFECYCLE, PRIORITY_META, STATUS_META } from '@/features/issues/statusMeta'
import { colorForCategory } from '@/features/map/palette'
import { postLoginTarget, roleHome } from '@/routes/roles'
import { makeAdminIssue, makeAssignment, makeOfficerIssue, platformAnalytics } from '@/test/staff'
import type { IssueStatus } from '@/types/api'
import { elapsedBetween, formatHours, formatRelative, greeting } from '@/utils/format'

import { planAdminActions } from './adminActions'
import { categorySlices, chartableDepartments, priorityRows, statusSlices, toWeekly, weekStart } from './analytics'
import { buildSteps } from './lifecycle'
import { planOfficerActions } from './officerActions'

const ALL_STATUSES: IssueStatus[] = ['reported', 'under_review', 'assigned', 'in_progress', 'resolved', 'reopened', 'rejected']

describe('status / priority meta', () => {
  it('every status and priority has a label and an icon (so no badge can render blank)', () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_META[status].label.length).toBeGreaterThan(0)
      expect(STATUS_META[status].icon).toBeTruthy()
    }
    for (const priority of ['low', 'medium', 'high', 'critical'] as const) {
      expect(PRIORITY_META[priority].label.length).toBeGreaterThan(0)
      expect(PRIORITY_META[priority].icon).toBeTruthy()
    }
  })

  it('the lifecycle is the five-step happy path', () => {
    expect(LIFECYCLE).toEqual(['reported', 'under_review', 'assigned', 'in_progress', 'resolved'])
  })
})

describe('weekly bucketing', () => {
  it('weekStart is the Monday of that week', () => {
    expect(weekStart('2026-11-02')).toBe('2026-11-02') // Monday
    expect(weekStart('2026-11-08')).toBe('2026-11-02') // Sunday
    expect(weekStart('2026-11-09')).toBe('2026-11-09')
    expect(weekStart('2026-01-01')).toBe('2025-12-29') // crosses the year boundary
  })

  it('sums days into weeks without losing or inventing anything', () => {
    const days = Array.from({ length: 21 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 5 + i)).toISOString().slice(0, 10), reported: i, resolved: 1 })) // 5 Oct is a Monday
    const weeks = toWeekly(days)
    expect(weeks).toHaveLength(3)
    expect(weeks.map((w) => w.date)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19'])
    expect(weeks.reduce((s, w) => s + w.reported, 0)).toBe(days.reduce((s, d) => s + d.reported, 0))
    expect(weeks.map((w) => w.resolved)).toEqual([7, 7, 7])
    expect(weeks[0].reported).toBe(0 + 1 + 2 + 3 + 4 + 5 + 6)
  })

  it('a partial first week still gets its own bucket, in order', () => {
    const weeks = toWeekly([
      { date: '2026-10-07', reported: 1, resolved: 0 }, // Wednesday
      { date: '2026-10-12', reported: 2, resolved: 1 }, // next Monday
    ])
    expect(weeks).toEqual([
      { date: '2026-10-05', reported: 1, resolved: 0 },
      { date: '2026-10-12', reported: 2, resolved: 1 },
    ])
  })

  it('an empty series is an empty chart, not a crash', () => {
    expect(toWeekly([])).toEqual([])
  })
})

describe('chart data shaping', () => {
  const data = platformAnalytics()

  it('status slices use the status tokens and labels, in workflow order', () => {
    const slices = statusSlices(data.by_status)
    expect(slices.map((s) => s.label)).toEqual(['Reported', 'Under review', 'Assigned', 'In progress', 'Resolved', 'Reopened', 'Rejected'])
    expect(slices.find((s) => s.key === 'resolved')).toMatchObject({ value: 85, color: 'var(--status-resolved)' })
  })

  it('priority rows use the priority tokens', () => {
    expect(priorityRows(data.by_priority).find((r) => r.label === 'Critical')).toMatchObject({ value: 12, color: 'var(--priority-critical)' })
  })

  it('category slices are biggest first and wear the same colour as the map pin for that category', () => {
    const slices = categorySlices([
      { id: 2, name: 'Garbage', count: 5 },
      { id: 1, name: 'Pothole', count: 9 },
      { id: 3, name: 'Drainage', count: 5 },
    ])
    expect(slices.map((s) => s.label)).toEqual(['Pothole', 'Drainage', 'Garbage']) // ties broken by name
    expect(slices[0].color).toBe(colorForCategory(1))
    expect(slices[2].color).toBe(colorForCategory(2))
  })

  it('charts only departments that are active or have work in their queue, busiest first', () => {
    const rows = chartableDepartments([
      { ...data.departments[1] }, // Sanitation, 26
      { ...data.departments[2] }, // inactive and empty: dropped
      { ...data.departments[0] }, // Public Works, 60
      { ...data.departments[2], name: 'Old but busy', in_queue: 3 }, // inactive, still has work: kept
    ])
    expect(rows.map((d) => d.name)).toEqual(['Public Works', 'Sanitation', 'Old but busy'])
  })
})

describe('buildSteps (the stepper)', () => {
  const states = (status: IssueStatus) => buildSteps(status).map((s) => `${s.label}:${s.state}`)

  it('marks everything before the current step done, the current step current, the rest upcoming', () => {
    expect(states('in_progress')).toEqual(['reported:done', 'under_review:done', 'assigned:done', 'in_progress:current', 'resolved:upcoming'])
    expect(states('reported')).toEqual(['reported:current', 'under_review:upcoming', 'assigned:upcoming', 'in_progress:upcoming', 'resolved:upcoming'])
  })

  it('a resolved issue has exactly one current step: the last', () => {
    const steps = buildSteps('resolved')
    expect(steps.filter((s) => s.state === 'current')).toHaveLength(1)
    expect(steps.at(-1)?.state).toBe('current')
    expect(steps.slice(0, -1).every((s) => s.state === 'done')).toBe(true)
  })

  it('a rejected issue ends the path early on a rejected step instead of pretending it will continue', () => {
    expect(states('rejected')).toEqual(['reported:done', 'rejected:current'])
  })

  it('a reopened issue shows "reopened" where review resumes, and the later steps are upcoming again', () => {
    expect(states('reopened')).toEqual(['reported:done', 'reopened:current', 'assigned:upcoming', 'in_progress:upcoming', 'resolved:upcoming'])
  })

  it.each(ALL_STATUSES)('%s always has exactly one current step', (status) => {
    expect(buildSteps(status).filter((s) => s.state === 'current')).toHaveLength(1)
  })
})

describe('planOfficerActions', () => {
  const mine = (status: IssueStatus, assignment = {}) => makeOfficerIssue({ status, assignment: makeAssignment({ is_mine: true, ...assignment }) })

  it('offers accept/send-back for an assigned issue waiting on me', () => {
    expect(planOfficerActions(mine('assigned', { status: 'pending' }))).toEqual({ kind: 'accept' })
  })

  it('offers resolve for an issue in progress that is mine', () => {
    expect(planOfficerActions(mine('in_progress', { status: 'accepted' }))).toEqual({ kind: 'resolve' })
  })

  it('offers nothing, with an explanation, in every other state', () => {
    for (const status of ['resolved', 'under_review', 'reopened', 'reported', 'rejected'] as IssueStatus[]) {
      const plan = planOfficerActions(mine(status, { status: 'accepted' }))
      expect(plan.kind).toBe('none')
      expect('message' in plan && plan.message.length).toBeGreaterThan(0)
    }
  })

  it('a colleague (not the assigned officer) is offered no action even when the status allows one', () => {
    const plan = planOfficerActions(makeOfficerIssue({ status: 'assigned', assignment: makeAssignment({ is_mine: false, status: 'pending' }) }))
    expect(plan).toMatchObject({ kind: 'none' })
    expect('message' in plan && plan.message).toMatch(/Rohit Chauhan.*Only they can act/)
  })

  it('an issue that left the queue has no actions', () => {
    expect(planOfficerActions(makeOfficerIssue({ assignment: null }))).toMatchObject({ kind: 'none' })
  })

  it('"assigned" but already accepted is not offered accept again', () => {
    expect(planOfficerActions(mine('assigned', { status: 'accepted' })).kind).not.toBe('accept')
  })
})

describe('planAdminActions (mirrors the backend rules)', () => {
  const issue = (status: IssueStatus, moderation: 'pending' | 'approved' | 'rejected' = 'approved') => makeAdminIssue({ status, moderation_status: moderation })
  const flags = (i: ReturnType<typeof issue>) => {
    const { approve, reject, assign, reopen } = planAdminActions(i)
    return { approve, reject, assign, reopen }
  }

  it('a new pending report can be approved or rejected, nothing else', () => {
    expect(flags(issue('reported', 'pending'))).toEqual({ approve: true, reject: true, assign: false, reopen: false })
  })

  it('an issue under review can be assigned or rejected', () => {
    expect(flags(issue('under_review'))).toEqual({ approve: false, reject: true, assign: true, reopen: false })
  })

  it('a reopened issue can be reassigned', () => {
    expect(flags(issue('reopened'))).toEqual({ approve: false, reject: false, assign: true, reopen: false })
  })

  it('a resolved issue can be reopened', () => {
    expect(flags(issue('resolved'))).toEqual({ approve: false, reject: false, assign: false, reopen: true })
  })

  it.each(['assigned', 'in_progress', 'rejected'] as IssueStatus[])('%s offers no action and says why', (status) => {
    const i = issue(status, status === 'rejected' ? 'rejected' : 'approved')
    expect(flags(i)).toEqual({ approve: false, reject: false, assign: false, reopen: false })
    expect(planAdminActions(i).note).toBeTruthy()
  })

  it('a rejected moderation state never offers assign, whatever the status says', () => {
    expect(planAdminActions(issue('under_review', 'rejected')).assign).toBe(false)
  })

  it('actions never come with a "nothing to do" note', () => {
    expect(planAdminActions(issue('resolved')).note).toBeNull()
  })
})

describe('roles and where they land', () => {
  it('each role has its own home', () => {
    expect(roleHome('citizen')).toBe('/dashboard')
    expect(roleHome('officer')).toBe('/officer')
    expect(roleHome('admin')).toBe('/admin')
    expect(roleHome(null)).toBe('/dashboard')
  })

  it('returns to the page you were headed for, but only inside your own area', () => {
    expect(postLoginTarget('citizen', '/report')).toBe('/report')
    expect(postLoginTarget('officer', '/officer/issues/abc')).toBe('/officer/issues/abc')
    expect(postLoginTarget('admin', '/admin/departments')).toBe('/admin/departments')
  })

  it.each([
    ['citizen', '/admin/issues'],
    ['citizen', '/officer'],
    ['officer', '/admin'],
    ['officer', '/report'],
    ['admin', '/officer/issues'],
    ['admin', '/dashboard'],
  ] as const)('%s asked for %s: sent home instead', (role, from) => {
    expect(postLoginTarget(role, from)).toBe(roleHome(role))
  })

  it.each(['//evil.example.com', 'https://evil.example.com', 'javascript:alert(1)', '/adminX', '/officers'])('rejects the suspicious target %s', (from) => {
    for (const role of ['citizen', 'officer', 'admin'] as const) {
      expect(postLoginTarget(role, from)).toBe(roleHome(role))
    }
  })

  it('"/adminX" is not inside the admin area (prefix match is on a path boundary)', () => {
    expect(postLoginTarget('admin', '/adminX')).toBe('/admin')
  })
})

describe('formatting', () => {
  it('formatHours reads like a person', () => {
    expect(formatHours(null)).toBe('—')
    expect(formatHours(undefined)).toBe('—')
    expect(formatHours(0.2)).toBe('12 min')
    expect(formatHours(0)).toBe('1 min') // never "0 min"
    expect(formatHours(5.6)).toBe('6 h')
    expect(formatHours(47)).toBe('47 h')
    expect(formatHours(48)).toBe('2 d')
    expect(formatHours(60)).toBe('2 d 12 h')
    expect(formatHours(116.7)).toBe('4 d 21 h')
  })

  it('elapsedBetween measures two timestamps', () => {
    expect(elapsedBetween('2026-11-01T00:00:00Z', '2026-11-01T06:00:00Z')).toBe('6 h')
    expect(elapsedBetween('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')).toBe('2 d')
  })

  it('formatRelative is relative to a given now', () => {
    const now = new Date('2026-11-07T12:00:00Z')
    expect(formatRelative('2026-11-07T11:59:40Z', now)).toBe('just now')
    expect(formatRelative('2026-11-07T11:00:00Z', now)).toBe('1 hour ago')
    expect(formatRelative('2026-11-06T12:00:00Z', now)).toBe('yesterday')
    expect(formatRelative('2026-11-04T12:00:00Z', now)).toBe('3 days ago')
    expect(formatRelative('not a date', now)).toBe('')
  })

  it('greeting changes with the hour', () => {
    expect(greeting(new Date(2026, 10, 7, 9))).toBe('Good morning')
    expect(greeting(new Date(2026, 10, 7, 12))).toBe('Good afternoon')
    expect(greeting(new Date(2026, 10, 7, 16, 59))).toBe('Good afternoon')
    expect(greeting(new Date(2026, 10, 7, 17))).toBe('Good evening')
  })
})
