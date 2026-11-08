import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetLeafletMock } from '@/test/leafletMock'
import { server } from '@/test/server'
import {
  adminListHandler,
  makeAdminIssue,
  makeAssignment,
  makeDepartment,
  makeHistory,
  platformAnalytics,
  staffDefaults,
  type ListCall,
} from '@/test/staff'
import { renderApp, signInAs, url } from '@/test/utils'
import type { IssueComment } from '@/types/api'
import type { AdminIssue } from '@/types/staff'

vi.mock('react-leaflet', async () => (await import('@/test/leafletMock')).reactLeafletMock)
vi.mock('react-leaflet-cluster', async () => (await import('@/test/leafletMock')).clusterMock)

beforeEach(resetLeafletMock)

function asAdmin(opts: Parameters<typeof staffDefaults>[0] = {}) {
  signInAs('admin', { full_name: 'Anita Deshpande', email: 'anita@example.com' })
  server.use(...staffDefaults(opts))
}

describe('Admin overview', () => {
  it('greets the admin and shows the platform numbers from the analytics endpoint', async () => {
    asAdmin()
    server.use(adminListHandler([]))
    renderApp('/admin')
    expect(await screen.findByRole('heading', { name: /good (morning|afternoon|evening), anita/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Total issues: 160')).toBeInTheDocument())
    expect(screen.getByLabelText('Awaiting moderation: 7')).toBeInTheDocument()
    expect(screen.getByLabelText('Open issues: 65')).toBeInTheDocument()
    expect(screen.getByLabelText('Resolved: 85')).toBeInTheDocument()
    expect(screen.getByLabelText('Flagged by residents: 4')).toBeInTheDocument()
    expect(screen.getByLabelText('Average resolution time: 4 d 16 h')).toBeInTheDocument() // 112 h
  })

  it('the tiles link into the matching filtered table', async () => {
    asAdmin()
    server.use(adminListHandler([]))
    renderApp('/admin')
    await screen.findByLabelText('Total issues: 160')
    expect(screen.getByTestId('tile-moderation')).toHaveAttribute('href', '/admin/issues?moderation_status=pending')
    expect(screen.getByTestId('tile-flagged')).toHaveAttribute('href', '/admin/issues?flagged=true')
    expect(screen.getByTestId('tile-resolved')).toHaveAttribute('href', '/admin/issues?status=resolved')
  })

  it('says nothing needs attention when the tiles are at zero', async () => {
    asAdmin()
    server.use(
      http.get(url('/admin/analytics/'), () => HttpResponse.json(platformAnalytics({ totals: { ...platformAnalytics().totals, awaiting_moderation: 0, flagged: 0 } }))),
      adminListHandler([]),
    )
    renderApp('/admin')
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument()
    expect(screen.getByText('Nothing flagged')).toBeInTheDocument()
  })

  it('lists the pending reports, asks the backend for pending ones by urgency, and links to each', async () => {
    asAdmin()
    const calls: ListCall[] = []
    const pending = makeAdminIssue({ title: 'Broken streetlight', moderation_status: 'pending', status: 'reported', priority: 'high' })
    server.use(adminListHandler([pending, makeAdminIssue({ title: 'Already approved', moderation_status: 'approved' })], calls))
    renderApp('/admin')
    const panel = await screen.findByRole('region', { name: 'Needs moderation' })
    const link = await within(panel).findByRole('link', { name: /broken streetlight/i })
    expect(link).toHaveAttribute('href', `/admin/issues/${pending.id}`)
    expect(within(panel).queryByText('Already approved')).not.toBeInTheDocument()
    expect(Object.fromEntries(calls[0].params)).toMatchObject({ moderation_status: 'pending', ordering: '-priority' })
  })

  it('celebrates an empty moderation queue', async () => {
    asAdmin()
    server.use(adminListHandler([]))
    renderApp('/admin')
    expect(await screen.findByText('The queue is clear')).toBeInTheDocument()
  })

  it('draws every chart from the analytics data, each with its numbers as a table', async () => {
    asAdmin()
    server.use(adminListHandler([]))
    renderApp('/admin')
    for (const id of ['chart-trend', 'chart-priority', 'chart-category', 'chart-departments']) {
      const chart = await screen.findByTestId(id)
      await waitFor(() => expect(chart.querySelector('svg.recharts-surface')).toBeInTheDocument())
      expect(within(chart).getAllByRole('table').length).toBeGreaterThan(0)
    }
    expect(within(screen.getByTestId('chart-priority')).getByRole('table', { name: 'Issues by priority' })).toHaveTextContent('Critical12')
    const departments = within(screen.getByTestId('chart-departments')).getByRole('table', { name: 'Department queues by state' })
    expect(departments).toHaveTextContent('Public Works')
    expect(departments).not.toHaveTextContent('Closed Dept') // inactive and empty: nothing to draw
  })

  it('shows an error with retry when analytics fail, and recovers', async () => {
    signInAs('admin')
    let attempts = 0
    server.use(
      http.get(url('/admin/analytics/'), () => {
        attempts++
        return attempts === 1 ? HttpResponse.json({ detail: 'Analytics unavailable' }, { status: 500 }) : HttpResponse.json(platformAnalytics())
      }),
      ...staffDefaults(),
      adminListHandler([]),
    )
    renderApp('/admin')
    expect(await screen.findByText('Analytics unavailable')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByLabelText('Total issues: 160')).toBeInTheDocument()
  })
})

describe('Admin issues table', () => {
  const issues = [
    makeAdminIssue({ title: 'Bravo pothole', moderation_status: 'approved', status: 'in_progress', priority: 'low', vote_count: 5, report_count: 0, created_at: '2026-11-01T10:00:00Z' }),
    makeAdminIssue({ title: 'Alpha spam', moderation_status: 'pending', status: 'reported', priority: 'critical', vote_count: 9, report_count: 3, created_at: '2026-11-03T10:00:00Z' }),
    makeAdminIssue({ title: 'Charlie rejected', moderation_status: 'rejected', status: 'rejected', priority: 'high', vote_count: 1, report_count: 1, created_at: '2026-11-02T10:00:00Z' }),
  ]
  const titles = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0].textContent)

  async function open(path = '/admin/issues', data: AdminIssue[] = issues) {
    asAdmin()
    const calls: ListCall[] = []
    server.use(adminListHandler(data, calls))
    const rendered = renderApp(path)
    const table = await screen.findByRole('table', { name: 'All issues' })
    // The table is rendered immediately, with skeleton rows; wait until the first page has actually loaded.
    await waitFor(() => expect(table).not.toHaveAttribute('aria-busy', 'true'))
    return { calls, ...rendered }
  }

  it('lists every issue newest first. An unreviewed issue shows its moderation state, not the meaningless "Reported"', async () => {
    const { calls } = await open()
    await waitFor(() => expect(titles()).toEqual(['Alpha spam', 'Charlie rejected', 'Bravo pothole']))
    const pending = screen.getByText('Alpha spam').closest('tr')!
    expect(within(pending).getByText('Awaiting review')).toBeInTheDocument()
    expect(within(pending).queryByText('Reported')).not.toBeInTheDocument()
    expect(within(screen.getByText('Bravo pothole').closest('tr')!).getByText('In progress')).toHaveAttribute('data-status', 'in_progress')
    expect(within(pending).getByText('3')).toBeInTheDocument() // flags
    expect(Object.fromEntries(calls[0].params)).toEqual({ ordering: '-created_at', page: '1' })
    expect(screen.getByText('Showing 1–3 of 3')).toBeInTheDocument()
  })

  it('the moderation filter goes to the backend and lives in the URL', async () => {
    const { calls, router } = await open()
    await userEvent.click(screen.getByRole('button', { name: 'Awaiting review' }))
    await waitFor(() => expect(titles()).toEqual(['Alpha spam']))
    expect(Object.fromEntries(calls.at(-1)!.params)).toMatchObject({ moderation_status: 'pending', page: '1' })
    expect(router.state.location.search).toBe('?moderation_status=pending')
  })

  it('status, category and flagged filters each go to the backend, and "Clear filters" resets all', async () => {
    const { calls, router } = await open()
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'in_progress')
    await waitFor(() => expect(titles()).toEqual(['Bravo pothole']))
    expect(calls.at(-1)!.params.get('status')).toBe('in_progress')

    await userEvent.selectOptions(screen.getByLabelText('Status'), '')
    await userEvent.click(screen.getByRole('button', { name: /flagged only/i }))
    await waitFor(() => expect(titles()).toEqual(['Alpha spam', 'Charlie rejected']))
    expect(calls.at(-1)!.params.get('flagged')).toBe('true')
    expect(screen.getByRole('button', { name: /flagged only/i })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Category' }), '2')
    await waitFor(() => expect(calls.at(-1)!.params.get('category')).toBe('2'))

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(titles()).toHaveLength(3))
    expect(router.state.location.search).toBe('')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('sorting is done by the backend, with the sort in the URL', async () => {
    const { calls, router } = await open()
    await userEvent.click(screen.getByRole('button', { name: 'Flags' }))
    await waitFor(() => expect(titles()).toEqual(['Alpha spam', 'Charlie rejected', 'Bravo pothole']))
    expect(calls.at(-1)!.params.get('ordering')).toBe('-reports')
    expect(screen.getByRole('columnheader', { name: 'Flags' })).toHaveAttribute('aria-sort', 'descending')
    expect(router.state.location.search).toBe('?ordering=-reports')

    await userEvent.click(screen.getByRole('button', { name: 'Issue' }))
    await waitFor(() => expect(titles()).toEqual(['Alpha spam', 'Bravo pothole', 'Charlie rejected']))
    expect(calls.at(-1)!.params.get('ordering')).toBe('title')
  })

  it('ignores hand-edited filters and sort keys instead of sending them to the API', async () => {
    const { calls } = await open('/admin/issues?ordering=password&moderation_status=bogus&status=nope&category=abc&page=-4')
    await waitFor(() => expect(titles()).toHaveLength(3))
    expect(Object.fromEntries(calls[0].params)).toEqual({ ordering: '-created_at', page: '1' })
  })

  it('paginates through the backend and returns to page 1 when a filter changes', async () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      makeAdminIssue({ title: `Issue ${String(i).padStart(2, '0')}`, status: i < 30 ? 'in_progress' : 'resolved', created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }),
    )
    const { calls } = await open('/admin/issues', many)
    expect(await screen.findByText('Showing 1–20 of 45')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 21–40 of 45')).toBeInTheDocument()
    expect(calls.at(-1)!.params.get('page')).toBe('2')

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'in_progress')
    await waitFor(() => expect(calls.at(-1)!.params.get('status')).toBe('in_progress'))
    expect(calls.at(-1)!.params.get('page')).toBe('1')
  })

  it('clicking a row opens the issue', async () => {
    const { router } = await open()
    server.use(http.get(url(`/admin/issues/${issues[1].id}/`), () => HttpResponse.json({ ...issues[1], status_history: makeHistory(['reported']) })))
    await userEvent.click(screen.getByText('Alpha spam'))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/admin/issues/${issues[1].id}`))
  })

  it('quick-approve is offered only for unreviewed issues, approves WITHOUT opening the row, and refreshes the list', async () => {
    const posts: string[] = []
    const rows = issues.map((i) => ({ ...i }))
    const { router } = await open('/admin/issues', rows)
    server.use(
      http.post(url(`/admin/issues/${issues[1].id}/approve/`), () => {
        posts.push('approve')
        Object.assign(rows[1], { moderation_status: 'approved', status: 'under_review' })
        return HttpResponse.json(rows[1])
      }),
    )
    expect(screen.getAllByRole('button', { name: /^Approve / })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Approve Alpha spam' }))
    expect(await screen.findByText('Issue approved and moved to review.')).toBeInTheDocument()
    expect(posts).toEqual(['approve'])
    expect(router.state.location.pathname).toBe('/admin/issues') // the click did not also open the row
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Approve / })).not.toBeInTheDocument())
    expect(within(screen.getByText('Alpha spam').closest('tr')!).getByText('Under review')).toBeInTheDocument()
  })

  it('a refused quick-approve shows the server message', async () => {
    await open()
    server.use(http.post(url(`/admin/issues/${issues[1].id}/approve/`), () => HttpResponse.json({ detail: 'Only pending issues can be approved.' }, { status: 409 })))
    await userEvent.click(screen.getByRole('button', { name: 'Approve Alpha spam' }))
    expect(await screen.findByText('Only pending issues can be approved.')).toBeInTheDocument()
  })

  it('different empty states for "no issues" and "nothing matches the filter"', async () => {
    await open('/admin/issues', [])
    expect(await screen.findByText('Nothing has been reported yet.')).toBeInTheDocument()
  })

  it('an empty filter result suggests removing a filter', async () => {
    await open('/admin/issues?moderation_status=approved&status=resolved')
    expect(await screen.findByText('Try removing a filter.')).toBeInTheDocument()
  })

  it('shows the server error with retry', async () => {
    asAdmin()
    server.use(http.get(url('/admin/issues/'), () => HttpResponse.json({ detail: 'Issues unavailable' }, { status: 500 })))
    renderApp('/admin/issues')
    expect(await screen.findByText('Issues unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})

describe('Admin issue page', () => {
  const comments: IssueComment[] = [
    { id: 'c1', author_name: 'Asha Verma', content: 'This has been here for weeks.', is_mine: false, created_at: '2026-11-02T10:00:00Z' },
    { id: 'c2', author_name: 'Imran Qureshi', content: 'Buy cheap watches!', is_mine: false, created_at: '2026-11-03T10:00:00Z' },
  ]

  /** A stateful backend for one issue so actions change what the next GET returns, like the real API. */
  function backend(initial: Partial<AdminIssue> = {}, departments = [makeDepartment({ id: 'dept-1' })]) {
    const state = {
      issue: makeAdminIssue({ id: 'issue-1', title: 'Broken streetlight on MG Road', moderation_status: 'pending', status: 'reported', report_count: 0, ...initial }),
      history: makeHistory(['reported']),
      comments: [...comments],
      posts: [] as { path: string; body: unknown }[],
    }
    const move = (patch: Partial<AdminIssue>, statuses: Parameters<typeof makeHistory>[0]) => {
      state.issue = { ...state.issue, ...patch }
      state.history = makeHistory(statuses)
      return HttpResponse.json(state.issue)
    }
    server.use(
      http.get(url('/admin/issues/issue-1/'), () => HttpResponse.json({ ...state.issue, status_history: state.history })),
      http.get(url('/issues/issue-1/comments/'), () => HttpResponse.json({ count: state.comments.length, next: null, previous: null, results: state.comments })),
      http.post(url('/admin/issues/issue-1/approve/'), () => {
        state.posts.push({ path: 'approve', body: null })
        return move({ moderation_status: 'approved', status: 'under_review' }, ['reported', 'under_review'])
      }),
      http.post(url('/admin/issues/issue-1/reject/'), async ({ request }) => {
        state.posts.push({ path: 'reject', body: await request.json() })
        return move({ moderation_status: 'rejected', status: 'rejected' }, ['reported', 'rejected'])
      }),
      http.post(url('/admin/issues/issue-1/assign/'), async ({ request }) => {
        state.posts.push({ path: 'assign', body: await request.json() })
        return move({ status: 'assigned', assignment: makeAssignment({ status: 'pending' }) }, ['reported', 'under_review', 'assigned'])
      }),
      http.post(url('/admin/issues/issue-1/reopen/'), async ({ request }) => {
        state.posts.push({ path: 'reopen', body: await request.json() })
        return move({ status: 'reopened' }, ['reported', 'under_review', 'assigned', 'in_progress', 'resolved', 'reopened'])
      }),
      http.post(url('/admin/comments/:id/hide/'), ({ params }) => {
        state.posts.push({ path: 'hide', body: params.id })
        state.comments = state.comments.filter((c) => c.id !== params.id)
        return HttpResponse.json({ id: params.id, is_hidden: true })
      }),
    )
    server.use(...staffDefaults({ departments }))
    return state
  }

  async function open() {
    signInAs('admin', { full_name: 'Anita Deshpande' })
    const rendered = renderApp('/admin/issues/issue-1')
    await screen.findByRole('heading', { name: 'Broken streetlight on MG Road' })
    return rendered
  }
  const progress = () => within(screen.getByRole('list', { name: 'Progress' }))

  it('shows the whole picture: header, stepper, activity timeline, reporter, details and moderation state', async () => {
    backend({ report_count: 2 })
    await open()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Issues')
    expect(progress().getByText('Reported').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(await screen.findByRole('list', { name: 'Status history' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Reporter' })).getByText('asha@example.com')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Details' })).getByText('Flags').nextSibling).toHaveTextContent('2')
    const moderation = screen.getByRole('region', { name: 'Moderation' })
    expect(within(moderation).getByText('Flagged by 2 residents')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Assignment' })).getByText('Not assigned to a department yet.')).toBeInTheDocument()
  })

  it('a pending issue offers approve and reject, but not assign or reopen', async () => {
    backend()
    await open()
    expect(screen.getByRole('button', { name: 'Approve and start review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /assign to a department/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reopen/i })).not.toBeInTheDocument()
  })

  it('approving: posts, toasts, the issue moves to review and the next action (assign) appears', async () => {
    const state = backend()
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Approve and start review' }))
    expect(await screen.findByText('Issue approved and moved to review.')).toBeInTheDocument()
    expect(state.posts.map((p) => p.path)).toEqual(['approve'])
    expect(await screen.findByRole('button', { name: 'Assign to a department…' })).toBeInTheDocument()
    await waitFor(() => expect(progress().getByText('Under review').closest('li')).toHaveAttribute('aria-current', 'step'))
    expect(screen.queryByRole('button', { name: 'Approve and start review' })).not.toBeInTheDocument()
  })

  it('rejecting needs a reason, sends exactly that, and the issue becomes final', async () => {
    const state = backend()
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Reject…' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject issue' }))
    expect(await within(dialog).findByText('Give a short reason (at least 3 characters)')).toBeInTheDocument()
    expect(state.posts).toHaveLength(0)

    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Duplicate of MG-102')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject issue' }))
    expect(await screen.findByText('Issue rejected.')).toBeInTheDocument()
    expect(state.posts).toEqual([{ path: 'reject', body: { reason: 'Duplicate of MG-102' } }])
    expect(await screen.findByText('This issue was rejected. That is final.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject…' })).not.toBeInTheDocument()
  })

  describe('assigning', () => {
    const approved = { moderation_status: 'approved' as const, status: 'under_review' as const }
    const departments = [
      makeDepartment({ id: 'dept-1', name: 'Public Works', officers: [{ id: 'officer-1', name: 'Rohit Chauhan', employee_reference: 'PW-101' }, { id: 'officer-2', name: 'Meera Joshi', employee_reference: 'PW-102' }] }),
      makeDepartment({ id: 'dept-2', name: 'Sanitation', officers: [{ id: 'officer-3', name: 'Imran Qureshi', employee_reference: 'SAN-201' }] }),
      makeDepartment({ id: 'dept-3', name: 'Empty Dept', officers: [] }),
      makeDepartment({ id: 'dept-4', name: 'Closed Dept', is_active: false }),
    ]

    it('offers only active departments that have officers, and an officer picker limited to the chosen department', async () => {
      backend(approved, departments)
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Assign to a department…' }))
      const dialog = await screen.findByRole('dialog')
      const department = await within(dialog).findByLabelText('Department')
      expect(within(department).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select a department', 'Public Works (2 officers)', 'Sanitation (1 officer)'])

      const officer = within(dialog).getByLabelText('Officer')
      expect(officer).toBeDisabled()
      await userEvent.selectOptions(department, 'dept-1')
      expect(officer).toBeEnabled()
      expect(within(officer).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select an officer', 'Rohit Chauhan · PW-101', 'Meera Joshi · PW-102'])
    })

    it('changing the department clears the officer, so an officer from another department can never be sent', async () => {
      const state = backend(approved, departments)
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Assign to a department…' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.selectOptions(await within(dialog).findByLabelText('Department'), 'dept-1')
      await userEvent.selectOptions(within(dialog).getByLabelText('Officer'), 'officer-2')
      await userEvent.selectOptions(within(dialog).getByLabelText('Department'), 'dept-2')
      expect(within(dialog).getByLabelText('Officer')).toHaveValue('')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }))
      expect(await within(dialog).findByText('Choose an officer.')).toBeInTheDocument()
      expect(state.posts).toHaveLength(0)
    })

    it('asks for a department first when nothing is chosen', async () => {
      const state = backend(approved, departments)
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Assign to a department…' }))
      const dialog = await screen.findByRole('dialog')
      await within(dialog).findByLabelText('Department')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }))
      expect(await within(dialog).findByText('Choose a department.')).toBeInTheDocument()
      expect(state.posts).toHaveLength(0)
    })

    it('sends the department and officer, then shows the assignment and Assigned status', async () => {
      const state = backend(approved, departments)
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Assign to a department…' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.selectOptions(await within(dialog).findByLabelText('Department'), 'dept-1')
      await userEvent.selectOptions(within(dialog).getByLabelText('Officer'), 'officer-1')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }))
      expect(await screen.findByText('Issue assigned.')).toBeInTheDocument()
      expect(state.posts).toEqual([{ path: 'assign', body: { department: 'dept-1', officer: 'officer-1' } }])
      await waitFor(() => expect(progress().getByText('Assigned').closest('li')).toHaveAttribute('aria-current', 'step'))
      expect(within(screen.getByRole('region', { name: 'Assignment' })).getByText('Rohit Chauhan')).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('keeps the dialog open and shows the server message when the assignment is refused', async () => {
      backend(approved, departments)
      server.use(http.post(url('/admin/issues/issue-1/assign/'), () => HttpResponse.json({ detail: 'That officer does not belong to this department.' }, { status: 400 })))
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Assign to a department…' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.selectOptions(await within(dialog).findByLabelText('Department'), 'dept-1')
      await userEvent.selectOptions(within(dialog).getByLabelText('Officer'), 'officer-1')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }))
      expect(await screen.findByText('That officer does not belong to this department.')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('an already assigned issue can be reassigned? No: only review/reopened issues offer it', async () => {
      backend({ moderation_status: 'approved', status: 'assigned', assignment: makeAssignment() }, departments)
      await open()
      expect(screen.queryByRole('button', { name: /assign to a department|reassign/i })).not.toBeInTheDocument()
      expect(await screen.findByText('Waiting for the assigned officer to accept it.')).toBeInTheDocument()
    })
  })

  describe('reopening', () => {
    const resolved = { moderation_status: 'approved' as const, status: 'resolved' as const, assignment: makeAssignment({ status: 'accepted' }) }

    it('a resolved issue offers reopen with a mandatory reason', async () => {
      const state = backend(resolved)
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Reopen…' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Reopen issue' }))
      expect(await within(dialog).findByText('Give a short reason (at least 3 characters)')).toBeInTheDocument()
      expect(state.posts).toHaveLength(0)

      await userEvent.type(within(dialog).getByLabelText('Reason'), 'The pothole is back after the rain')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Reopen issue' }))
      expect(await screen.findByText('Issue reopened.')).toBeInTheDocument()
      expect(state.posts).toEqual([{ path: 'reopen', body: { reason: 'The pothole is back after the rain' } }])
      await waitFor(() => expect(progress().getByText('Reopened').closest('li')).toHaveAttribute('aria-current', 'step'))
      expect(await screen.findByRole('button', { name: /^Reassign…$|Assign to a department…/ })).toBeInTheDocument() // it can be assigned again
    })

    it('shows the 409 message when the issue is no longer resolved', async () => {
      backend(resolved)
      server.use(http.post(url('/admin/issues/issue-1/reopen/'), () => HttpResponse.json({ detail: 'Only resolved issues can be reopened.' }, { status: 409 })))
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Reopen…' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.type(within(dialog).getByLabelText('Reason'), 'Came back again')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Reopen issue' }))
      expect(await screen.findByText('Only resolved issues can be reopened.')).toBeInTheDocument()
    })
  })

  describe('comments', () => {
    it('lists the public comments and hides one only after confirmation', async () => {
      const state = backend({ moderation_status: 'approved', status: 'under_review' })
      await open()
      const panel = await screen.findByRole('region', { name: 'Comments' })
      expect(await within(panel).findByText('Buy cheap watches!')).toBeInTheDocument()

      await userEvent.click(within(panel).getByRole('button', { name: 'Hide comment by Imran Qureshi' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/Buy cheap watches!/)).toBeInTheDocument() // you see what you are hiding
      expect(state.posts).toHaveLength(0)

      await userEvent.click(within(dialog).getByRole('button', { name: 'Hide comment' }))
      expect(await screen.findByText('Comment hidden from public view.')).toBeInTheDocument()
      expect(state.posts).toEqual([{ path: 'hide', body: 'c2' }])
      await waitFor(() => expect(within(panel).queryByText('Buy cheap watches!')).not.toBeInTheDocument())
      expect(within(panel).getByText('This has been here for weeks.')).toBeInTheDocument()
    })

    it('cancelling the confirmation hides nothing', async () => {
      const state = backend({ moderation_status: 'approved', status: 'under_review' })
      await open()
      const panel = await screen.findByRole('region', { name: 'Comments' })
      await userEvent.click(await within(panel).findByRole('button', { name: 'Hide comment by Asha Verma' }))
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(state.posts).toHaveLength(0)
      expect(within(panel).getByText('This has been here for weeks.')).toBeInTheDocument()
    })

    it('says comments open once public when the issue is not public yet (404), instead of showing an error', async () => {
      backend()
      server.use(http.get(url('/issues/issue-1/comments/'), () => HttpResponse.json({ detail: 'Not found.' }, { status: 404 })))
      await open()
      expect(await screen.findByText('Comments open once the issue is public.')).toBeInTheDocument()
    })

    it('says so when there are no visible comments', async () => {
      backend()
      server.use(http.get(url('/issues/issue-1/comments/'), () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })))
      await open()
      expect(await screen.findByText('No visible comments.')).toBeInTheDocument()
    })
  })

  it('a missing issue (404) shows a friendly page with a way back', async () => {
    signInAs('admin')
    server.use(...staffDefaults(), http.get(url('/admin/issues/issue-1/'), () => HttpResponse.json({ detail: 'Not found.' }, { status: 404 })))
    renderApp('/admin/issues/issue-1')
    expect(await screen.findByText('Issue not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to issues' })).toHaveAttribute('href', '/admin/issues')
  })

  it('a server error is an error with retry, not "not found"', async () => {
    signInAs('admin')
    server.use(...staffDefaults(), http.get(url('/admin/issues/issue-1/'), () => HttpResponse.json({ detail: 'Boom' }, { status: 500 })))
    renderApp('/admin/issues/issue-1')
    expect(await screen.findByText('Boom')).toBeInTheDocument()
    expect(screen.queryByText('Issue not found')).not.toBeInTheDocument()
  })
})

describe('Admin departments', () => {
  const works = makeDepartment({ id: 'dept-1', name: 'Public Works', description: 'Roads and potholes', city: 'Indore' })
  const closed = makeDepartment({ id: 'dept-3', name: 'Closed Dept', is_active: false, officers: [], description: '' })
  const deptRow = (name: string) => screen.getByText(name).closest('tr')!

  async function open(departments = [works, closed]) {
    asAdmin({ departments })
    renderApp('/admin/departments')
    const table = await screen.findByRole('table', { name: 'Departments' })
    await within(table).findByText(departments[0].name) // scoped: the row, not a chart label elsewhere on the page
  }

  it('lists departments with officer count, live queue numbers from analytics, and active state', async () => {
    await open()
    await waitFor(() => expect(within(deptRow('Public Works')).getByText('60')).toBeInTheDocument()) // in queue
    const row = within(deptRow('Public Works'))
    expect(row.getByText('36')).toBeInTheDocument() // resolved
    expect(row.getByText('3 d 14 h')).toBeInTheDocument() // 86 h
    expect(row.getByText('1 officer')).toBeInTheDocument()
    expect(row.getByText('Active')).toBeInTheDocument()
    expect(within(deptRow('Closed Dept')).getByText('Inactive')).toBeInTheDocument()
    expect(within(deptRow('Closed Dept')).getByText('None yet')).toBeInTheDocument()
  })

  it('shows a friendly empty state with a way to create the first department', async () => {
    asAdmin({ departments: [] })
    renderApp('/admin/departments')
    expect(await screen.findByText('No departments yet')).toBeInTheDocument()
    // The empty state sits beside the (header-only) table, not inside it; scope to it so this clicks ITS call to action.
    const emptyState = screen.getByRole('heading', { name: 'No departments yet' }).parentElement!.parentElement!
    await userEvent.click(within(emptyState).getByRole('button', { name: 'New department' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('New department')
  })

  describe('creating', () => {
    it('validates before sending anything', async () => {
      await open()
      const posts: unknown[] = []
      server.use(http.post(url('/admin/departments/'), async ({ request }) => (posts.push(await request.json()), HttpResponse.json(makeDepartment(), { status: 201 }))))
      await userEvent.click(screen.getByRole('button', { name: 'New department' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create department' }))
      expect(await within(dialog).findByText('Enter the department name')).toBeInTheDocument()
      expect(posts).toHaveLength(0)
    })

    it('creates it, closes the dialog, toasts, and the new department appears in the list', async () => {
      await open()
      const posts: unknown[] = []
      const created = makeDepartment({ id: 'dept-9', name: 'Water Board', city: 'Indore', description: 'Pipes and supply', officers: [] })
      let list = [works, closed]
      server.use(
        http.post(url('/admin/departments/'), async ({ request }) => {
          posts.push(await request.json())
          list = [...list, created]
          return HttpResponse.json(created, { status: 201 })
        }),
        http.get(url('/admin/departments/'), () => HttpResponse.json({ count: list.length, next: null, previous: null, results: list })),
      )
      await userEvent.click(screen.getByRole('button', { name: 'New department' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Water Board')
      await userEvent.type(within(dialog).getByLabelText('Description'), 'Pipes and supply')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create department' }))
      expect(await screen.findByText('Department created.')).toBeInTheDocument()
      expect(posts).toEqual([{ name: 'Water Board', city: 'Indore', description: 'Pipes and supply', is_active: true }])
      expect(await screen.findByText('Water Board')).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('puts a server-side field error (duplicate name) on the Name input and keeps the dialog open', async () => {
      await open()
      server.use(http.post(url('/admin/departments/'), () => HttpResponse.json({ name: ['A department with this name already exists in this city.'] }, { status: 400 })))
      await userEvent.click(screen.getByRole('button', { name: 'New department' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Public Works')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create department' }))
      expect(await within(dialog).findByText('A department with this name already exists in this city.', { selector: 'p' })).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('editing', () => {
    it('opens pre-filled from the row, and PATCHes the changes', async () => {
      await open()
      const patches: unknown[] = []
      server.use(http.patch(url('/admin/departments/dept-1/'), async ({ request }) => (patches.push(await request.json()), HttpResponse.json({ ...works, is_active: false }))))
      await userEvent.click(screen.getByRole('button', { name: 'Edit Public Works' }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent('Edit department')
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Public Works')
      expect(within(dialog).getByLabelText('Description')).toHaveValue('Roads and potholes')

      await userEvent.click(within(dialog).getByRole('checkbox', { name: /active/i }))
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
      expect(await screen.findByText('Department updated.')).toBeInTheDocument()
      expect(patches).toEqual([{ name: 'Public Works', city: 'Indore', description: 'Roads and potholes', is_active: false }])
    })

    it('clicking the row itself also opens the editor', async () => {
      await open()
      await userEvent.click(screen.getByText('Roads and potholes'))
      expect(await screen.findByRole('dialog')).toHaveTextContent('Edit department')
    })

    it('the row action buttons do NOT also open the editor (click is not passed to the row)', async () => {
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Add officer to Public Works' }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent('Add an officer')
      expect(screen.queryByText('Edit department')).not.toBeInTheDocument()
      expect(within(dialog).getByLabelText('Department')).toHaveValue('dept-1') // pre-selected from the row
    })

    it('reopening the dialog after Cancel shows the saved values, not the abandoned edit', async () => {
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Public Works' }))
      let dialog = await screen.findByRole('dialog')
      await userEvent.clear(within(dialog).getByLabelText('Name'))
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Scratch')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await userEvent.click(screen.getByRole('button', { name: 'Edit Public Works' }))
      dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Public Works')
    })
  })

  describe('deleting', () => {
    it('asks first, and deletes only after confirmation', async () => {
      await open()
      const deletes: string[] = []
      server.use(http.delete(url('/admin/departments/dept-3/'), () => (deletes.push('dept-3'), new HttpResponse(null, { status: 204 }))))
      await userEvent.click(screen.getByRole('button', { name: 'Delete Closed Dept' }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent('Delete Closed Dept?')
      expect(deletes).toHaveLength(0)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete department' }))
      expect(await screen.findByText('Department deleted.')).toBeInTheDocument()
      expect(deletes).toEqual(['dept-3'])
    })

    it('shows the server explanation when the department is in use (409)', async () => {
      await open()
      server.use(http.delete(url('/admin/departments/dept-1/'), () => HttpResponse.json({ detail: 'This department has officers or assignments and cannot be deleted.' }, { status: 409 })))
      await userEvent.click(screen.getByRole('button', { name: 'Delete Public Works' }))
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete department' }))
      expect(await screen.findByText('This department has officers or assignments and cannot be deleted.')).toBeInTheDocument()
      expect(screen.getByText('Public Works')).toBeInTheDocument() // still listed
    })

    it('cancel deletes nothing', async () => {
      await open()
      const deletes: string[] = []
      server.use(http.delete(url('/admin/departments/dept-3/'), () => (deletes.push('x'), new HttpResponse(null, { status: 204 }))))
      await userEvent.click(screen.getByRole('button', { name: 'Delete Closed Dept' }))
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(deletes).toHaveLength(0)
    })
  })

  describe('adding an officer', () => {
    async function fill(dialog: HTMLElement, over: Partial<Record<'name' | 'email' | 'password' | 'ref', string>> = {}) {
      const v = { name: 'Meera Joshi', email: 'meera@example.com', password: 'Str0ng-pass!', ref: 'PW-105', ...over }
      await userEvent.type(within(dialog).getByLabelText('Full name'), v.name)
      await userEvent.type(within(dialog).getByLabelText('Email'), v.email)
      await userEvent.type(within(dialog).getByLabelText('Temporary password'), v.password)
      await userEvent.type(within(dialog).getByLabelText('Employee reference'), v.ref)
    }

    it('validates every field before sending', async () => {
      await open()
      const posts: unknown[] = []
      server.use(http.post(url('/admin/officers/'), async ({ request }) => (posts.push(await request.json()), HttpResponse.json({}, { status: 201 }))))
      await userEvent.click(screen.getByRole('button', { name: 'Add officer' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create officer' }))
      expect(await within(dialog).findByText('Enter the officer’s full name')).toBeInTheDocument()
      expect(within(dialog).getByText('Enter a valid email address')).toBeInTheDocument()
      expect(within(dialog).getByText('Password must be at least 8 characters')).toBeInTheDocument()
      expect(within(dialog).getByText('Choose a department')).toBeInTheDocument()
      expect(within(dialog).getByText('Enter the employee reference')).toBeInTheDocument()
      expect(posts).toHaveLength(0)
    })

    it('rejects an all-numeric password client-side', async () => {
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Add officer' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.type(within(dialog).getByLabelText('Temporary password'), '12345678')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create officer' }))
      expect(await within(dialog).findByText('Password cannot be only numbers')).toBeInTheDocument()
    })

    it('only offers active departments, and sends exactly the five fields (never a role)', async () => {
      await open()
      const posts: Record<string, unknown>[] = []
      server.use(
        http.post(url('/admin/officers/'), async ({ request }) => {
          posts.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json({ id: 'o9', name: 'Meera Joshi', employee_reference: 'PW-105', department: { id: 'dept-1', name: 'Public Works', city: 'Indore', is_active: true } }, { status: 201 })
        }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Add officer' }))
      const dialog = await screen.findByRole('dialog')
      const select = within(dialog).getByLabelText('Department')
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select a department', 'Public Works'])
      await fill(dialog)
      await userEvent.selectOptions(select, 'dept-1')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create officer' }))
      expect(await screen.findByText('Meera Joshi can now sign in as an officer.')).toBeInTheDocument()
      expect(posts).toEqual([{ full_name: 'Meera Joshi', email: 'meera@example.com', password: 'Str0ng-pass!', department: 'dept-1', employee_reference: 'PW-105' }])
      expect(posts[0]).not.toHaveProperty('role')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('maps a duplicate email from the server onto the Email input', async () => {
      await open()
      server.use(http.post(url('/admin/officers/'), () => HttpResponse.json({ email: ['A user with this email already exists.'] }, { status: 400 })))
      await userEvent.click(screen.getByRole('button', { name: 'Add officer' }))
      const dialog = await screen.findByRole('dialog')
      await fill(dialog, { email: 'asha@example.com' })
      await userEvent.selectOptions(within(dialog).getByLabelText('Department'), 'dept-1')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create officer' }))
      expect(await within(dialog).findByText('A user with this email already exists.', { selector: 'p' })).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('shows the server error with retry when departments cannot be loaded', async () => {
    asAdmin()
    server.use(http.get(url('/admin/departments/'), () => HttpResponse.json({ detail: 'Departments unavailable' }, { status: 500 })))
    renderApp('/admin/departments')
    expect(await screen.findByText('Departments unavailable')).toBeInTheDocument()
  })
})
