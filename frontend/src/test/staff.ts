import { http, HttpResponse } from 'msw'

import type { IssueStatus } from '@/types/api'
import type {
  AdminIssue,
  Assignment,
  Department,
  DepartmentAnalytics,
  DepartmentNote,
  OfficerIssue,
  PlatformAnalytics,
  StatusHistoryEntry,
} from '@/types/staff'

import { CATEGORIES, makeIssue } from './factories'
import { url } from './utils'

let counter = 0
const next = () => ++counter

export function makeAssignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: `assignment-${next()}`,
    department: { id: 'dept-1', name: 'Public Works' },
    officer: { id: 'officer-1', name: 'Rohit Chauhan', employee_reference: 'PW-101' },
    status: 'pending',
    rejection_reason: '',
    assigned_at: '2026-11-05T10:00:00+05:30',
    accepted_at: null,
    is_mine: true,
    ...over,
  }
}

/** A believable status trail, one hour apart, for the given statuses in order. */
export function makeHistory(statuses: IssueStatus[]): StatusHistoryEntry[] {
  const actors: Record<string, StatusHistoryEntry['changed_by']> = {
    reported: { name: 'Asha Verma', role: 'citizen' },
    under_review: { name: 'Anita Deshpande', role: 'admin' },
    assigned: { name: 'Anita Deshpande', role: 'admin' },
    in_progress: { name: 'Rohit Chauhan', role: 'officer' },
    resolved: { name: 'Rohit Chauhan', role: 'officer' },
    reopened: { name: 'Anita Deshpande', role: 'admin' },
    rejected: { name: 'Anita Deshpande', role: 'admin' },
  }
  return statuses.map((status, i) => ({
    id: `h-${next()}`,
    old_status: i === 0 ? '' : statuses[i - 1],
    new_status: status,
    changed_by: actors[status],
    reason: i === 0 ? 'Issue reported' : `Reason for ${status}`,
    created_at: new Date(Date.UTC(2026, 10, 1, 4 + i, 0)).toISOString(),
  }))
}

export function makeOfficerIssue(over: Partial<OfficerIssue> = {}): OfficerIssue {
  return {
    ...makeIssue({ moderation_status: undefined, is_public: undefined, is_mine: false, status: 'assigned' }),
    assignment: makeAssignment(),
    ...over,
  }
}

export function makeAdminIssue(over: Partial<AdminIssue> = {}): AdminIssue {
  return {
    ...makeIssue({ moderation_status: 'approved', is_public: true, is_mine: false, status: 'under_review' }),
    moderation_status: 'approved',
    is_public: true,
    reporter: { id: 'u1', full_name: 'Asha Verma', email: 'asha@example.com' },
    report_count: 0,
    assignment: null,
    ...over,
  }
}

export function makeDepartment(over: Partial<Department> = {}): Department {
  return {
    id: `dept-${next()}`,
    name: 'Public Works',
    description: 'Roads and potholes',
    city: 'Indore',
    is_active: true,
    officers: [{ id: 'officer-1', name: 'Rohit Chauhan', employee_reference: 'PW-101' }],
    ...over,
  }
}

export function makeNote(over: Partial<DepartmentNote> = {}): DepartmentNote {
  return { id: `n-${next()}`, author_name: 'Rohit Chauhan', department: 'Public Works', note: 'Site visited.', created_at: '2026-11-06T10:00:00+05:30', ...over }
}

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), reported: i % 3, resolved: i % 2 }))

const STATUS_ROWS = (counts: Partial<Record<IssueStatus, number>>) =>
  (['reported', 'under_review', 'assigned', 'in_progress', 'resolved', 'reopened', 'rejected'] as IssueStatus[]).map((status) => ({ status, count: counts[status] ?? 0 }))

export function platformAnalytics(over: Partial<PlatformAnalytics> = {}): PlatformAnalytics {
  return {
    range_days: 90,
    totals: { issues: 160, awaiting_moderation: 7, open: 65, resolved: 85, rejected: 3, flagged: 4, avg_resolution_hours: 112 },
    by_status: STATUS_ROWS({ reported: 7, under_review: 20, assigned: 15, in_progress: 30, resolved: 85, rejected: 3 }),
    by_priority: [
      { priority: 'low', count: 34 },
      { priority: 'medium', count: 82 },
      { priority: 'high', count: 32 },
      { priority: 'critical', count: 12 },
    ],
    by_category: CATEGORIES.map((c, i) => ({ id: c.id, name: c.name, count: 40 - i * 10 })),
    over_time: days(14),
    departments: [
      { id: 'dept-1', name: 'Public Works', city: 'Indore', is_active: true, in_queue: 60, in_progress: 20, resolved: 36, rejected_assignments: 1, avg_resolution_hours: 86 },
      { id: 'dept-2', name: 'Sanitation', city: 'Indore', is_active: true, in_queue: 26, in_progress: 5, resolved: 16, rejected_assignments: 0, avg_resolution_hours: 60 },
      { id: 'dept-3', name: 'Closed Dept', city: 'Indore', is_active: false, in_queue: 0, in_progress: 0, resolved: 0, rejected_assignments: 0, avg_resolution_hours: null },
    ],
    ...over,
  }
}

export function departmentAnalytics(over: Partial<DepartmentAnalytics> = {}): DepartmentAnalytics {
  return {
    range_days: 56,
    department: { id: 'dept-1', name: 'Public Works', city: 'Indore' },
    totals: { in_queue: 72, awaiting_acceptance: 6, in_progress: 35, resolved: 30, rejected_assignments: 1, avg_resolution_hours: 107 },
    by_status: STATUS_ROWS({ assigned: 6, in_progress: 35, resolved: 30, reopened: 1 }),
    by_priority: [
      { priority: 'low', count: 10 },
      { priority: 'medium', count: 40 },
      { priority: 'high', count: 15 },
      { priority: 'critical', count: 7 },
    ],
    by_category: CATEGORIES.map((c, i) => ({ id: c.id, name: c.name, count: 30 - i * 10 })),
    over_time: days(14),
    ...over,
  }
}

const PRIORITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const
const STATUS_RANK = ['reported', 'under_review', 'assigned', 'in_progress', 'resolved', 'reopened', 'rejected']

/** Apply ?ordering= like the Django view does (title, status, priority, votes, created_at; reports for admin). */
export function sortLikeBackend<T extends { title: string; status: IssueStatus; priority: keyof typeof PRIORITY_RANK; vote_count: number; created_at: string; report_count?: number }>(rows: T[], ordering: string | null): T[] {
  const desc = (ordering ?? '-created_at').startsWith('-')
  const key = (ordering ?? '-created_at').replace(/^-/, '')
  const value = (r: T): string | number =>
    key === 'title' ? r.title.toLowerCase() : key === 'status' ? STATUS_RANK.indexOf(r.status) : key === 'priority' ? PRIORITY_RANK[r.priority] : key === 'votes' ? r.vote_count : key === 'reports' ? (r.report_count ?? 0) : r.created_at
  return [...rows].sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0) * (desc ? -1 : 1))
}

export interface ListCall {
  params: URLSearchParams
}

function paged<T>(rows: T[], params: URLSearchParams, path: string) {
  const page = Number(params.get('page') ?? '1')
  const size = 20
  if (page < 1 || (page - 1) * size >= Math.max(rows.length, 1)) return HttpResponse.json({ detail: 'Invalid page.' }, { status: 404 })
  return HttpResponse.json({
    count: rows.length,
    next: page * size < rows.length ? url(`${path}?page=${page + 1}`) : null,
    previous: null,
    results: rows.slice((page - 1) * size, page * size),
  })
}

/** msw handler for GET /officer/issues/ : status filter, ordering, pagination. */
export function officerListHandler(issues: OfficerIssue[], calls: ListCall[] = []) {
  return http.get(url('/officer/issues/'), ({ request }) => {
    const params = new URL(request.url).searchParams
    calls.push({ params })
    let rows = issues
    const status = params.get('status')
    if (status) rows = rows.filter((i) => i.status === status)
    return paged(sortLikeBackend(rows, params.get('ordering')), params, '/officer/issues/')
  })
}

/** msw handler for GET /admin/issues/ : moderation/status/category/flagged filters, ordering, pagination. */
export function adminListHandler(issues: AdminIssue[], calls: ListCall[] = []) {
  return http.get(url('/admin/issues/'), ({ request }) => {
    const params = new URL(request.url).searchParams
    calls.push({ params })
    let rows = issues
    const m = params.get('moderation_status')
    const s = params.get('status')
    const c = params.get('category')
    if (m) rows = rows.filter((i) => i.moderation_status === m)
    if (s) rows = rows.filter((i) => i.status === s)
    if (c) rows = rows.filter((i) => String(i.category.id) === c)
    if (params.get('flagged') === 'true') rows = rows.filter((i) => i.report_count > 0)
    return paged(sortLikeBackend(rows, params.get('ordering')), params, '/admin/issues/')
  })
}

/** The endpoints every staff page may touch, answered with sensible data. Per-test handlers go first. */
export function staffDefaults(opts: { departments?: Department[] } = {}) {
  return [
    http.get(url('/officer/analytics/'), () => HttpResponse.json(departmentAnalytics())),
    http.get(url('/admin/analytics/'), () => HttpResponse.json(platformAnalytics())),
    http.get(url('/categories/'), () => HttpResponse.json(CATEGORIES)),
    http.get(url('/admin/departments/'), () => HttpResponse.json({ count: 1, next: null, previous: null, results: opts.departments ?? [makeDepartment({ id: 'dept-1' })] })),
  ]
}
