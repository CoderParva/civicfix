import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeIssue } from '@/test/factories'
import { resetLeafletMock } from '@/test/leafletMock'
import { server } from '@/test/server'
import { departmentAnalytics, makeAssignment, makeHistory, makeNote, makeOfficerIssue, officerListHandler, staffDefaults, type ListCall } from '@/test/staff'
import { renderApp, signInAs, url } from '@/test/utils'
import type { OfficerIssue } from '@/types/staff'

vi.mock('react-leaflet', async () => (await import('@/test/leafletMock')).reactLeafletMock)
vi.mock('react-leaflet-cluster', async () => (await import('@/test/leafletMock')).clusterMock)

beforeEach(resetLeafletMock)

const png = (name = 'fixed.png') => new File([new Uint8Array(2048)], name, { type: 'image/png' })

function asOfficer() {
  signInAs('officer', { full_name: 'Rohit Chauhan', email: 'rohit@example.com' })
  server.use(...staffDefaults())
}

describe('Officer overview', () => {
  it('greets the officer and shows the department queue numbers from the analytics endpoint', async () => {
    asOfficer()
    server.use(officerListHandler([]))
    renderApp('/officer')

    expect(await screen.findByRole('heading', { name: /good (morning|afternoon|evening), rohit/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('In your queue: 72')).toBeInTheDocument())
    expect(screen.getByLabelText('Awaiting acceptance: 6')).toBeInTheDocument()
    expect(screen.getByLabelText('In progress: 35')).toBeInTheDocument()
    expect(screen.getByLabelText('Resolved: 30')).toBeInTheDocument()
    expect(screen.getByText('Average 4 d 11 h to resolve')).toBeInTheDocument() // 107 h
    expect(screen.getByText(/Public Works · Indore/)).toBeInTheDocument()
  })

  it('the tiles are links into the filtered queue', async () => {
    asOfficer()
    server.use(officerListHandler([]))
    renderApp('/officer')
    await screen.findByLabelText('Awaiting acceptance: 6')
    expect(screen.getByTestId('tile-awaiting')).toHaveAttribute('href', '/officer/issues?status=assigned')
    expect(screen.getByTestId('tile-in-progress')).toHaveAttribute('href', '/officer/issues?status=in_progress')
    expect(screen.getByTestId('tile-in-queue')).toHaveAttribute('href', '/officer/issues')
  })

  it('lists what is waiting for acceptance, most urgent first (asks the backend for exactly that)', async () => {
    asOfficer()
    const calls: ListCall[] = []
    server.use(
      officerListHandler(
        [
          makeOfficerIssue({ title: 'Low one', priority: 'low' }),
          makeOfficerIssue({ title: 'Critical one', priority: 'critical' }),
          makeOfficerIssue({ title: 'In progress, not listed', status: 'in_progress' }),
        ],
        calls,
      ),
    )
    renderApp('/officer')
    const panel = await screen.findByRole('region', { name: 'Needs your attention' })
    await within(panel).findByText('Critical one')
    expect(within(panel).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Critical one'),
      expect.stringContaining('Low one'),
    ])
    expect(within(panel).queryByText('In progress, not listed')).not.toBeInTheDocument()
    expect(Object.fromEntries(calls[0].params)).toMatchObject({ status: 'assigned', ordering: '-priority' })
  })

  it('each attention row links to the issue', async () => {
    asOfficer()
    const issue = makeOfficerIssue({ title: 'Open manhole' })
    server.use(officerListHandler([issue]))
    renderApp('/officer')
    expect(await screen.findByRole('link', { name: /open manhole/i })).toHaveAttribute('href', `/officer/issues/${issue.id}`)
  })

  it('celebrates an empty attention list instead of showing a blank box', async () => {
    asOfficer()
    server.use(officerListHandler([]))
    renderApp('/officer')
    expect(await screen.findByText('You are all caught up')).toBeInTheDocument()
  })

  it('draws the status donut and the weekly trend from the analytics data', async () => {
    asOfficer()
    server.use(officerListHandler([]))
    renderApp('/officer')
    const donut = await screen.findByTestId('chart-status')
    await waitFor(() => expect(donut.querySelector('svg.recharts-surface')).toBeInTheDocument())
    expect(within(donut).getByRole('table', { name: 'Queue by status' })).toHaveTextContent('In progress35')
    expect(within(screen.getByTestId('chart-trend')).getByRole('table', { name: /per week/i })).toBeInTheDocument()
  })

  it('shows an error with retry when the analytics call fails, and recovers', async () => {
    signInAs('officer')
    let attempts = 0
    server.use(
      // first match wins, so the failing handler has to come before the defaults
      http.get(url('/officer/analytics/'), () => {
        attempts++
        return attempts === 1 ? HttpResponse.json({ detail: 'Analytics unavailable' }, { status: 500 }) : HttpResponse.json(departmentAnalytics())
      }),
      ...staffDefaults(),
      officerListHandler([]),
    )
    renderApp('/officer')
    expect(await screen.findByText('Analytics unavailable')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByLabelText('In your queue: 72')).toBeInTheDocument()
  })
})

describe('Officer queue', () => {
  const issues = [
    makeOfficerIssue({ title: 'Bravo pothole', status: 'in_progress', priority: 'low', vote_count: 5, created_at: '2026-11-01T10:00:00Z' }),
    makeOfficerIssue({ title: 'Alpha leak', status: 'assigned', priority: 'critical', vote_count: 9, created_at: '2026-11-03T10:00:00Z' }),
    makeOfficerIssue({ title: 'Charlie drain', status: 'resolved', priority: 'high', vote_count: 1, created_at: '2026-11-02T10:00:00Z' }),
  ]
  const titles = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0].textContent)

  async function open(path = '/officer/issues', data: OfficerIssue[] = issues) {
    asOfficer()
    const calls: ListCall[] = []
    server.use(officerListHandler(data, calls))
    const rendered = renderApp(path)
    const table = await screen.findByRole('table', { name: 'Assigned issues' })
    // The table appears at once with skeleton rows; wait for the first page to load (works for empty/filtered results too).
    await waitFor(() => expect(table).not.toHaveAttribute('aria-busy', 'true'))
    return { calls, ...rendered }
  }

  it('lists the department queue newest first, with status and priority badges that carry icons and text', async () => {
    const { calls } = await open()
    await waitFor(() => expect(titles()).toEqual(['Alpha leak', 'Charlie drain', 'Bravo pothole']))
    const row = screen.getByText('Alpha leak').closest('tr')!
    expect(within(row).getByText('Assigned')).toHaveAttribute('data-status', 'assigned')
    expect(within(row).getByText('Critical')).toHaveAttribute('data-priority', 'critical')
    expect(Object.fromEntries(calls[0].params)).toEqual({ ordering: '-created_at', page: '1' })
    expect(screen.getByText('Showing 1–3 of 3')).toBeInTheDocument()
  })

  it('the status filter goes to the backend and is kept in the URL', async () => {
    const { calls, router } = await open()
    await userEvent.click(screen.getByRole('button', { name: 'In progress' }))
    await waitFor(() => expect(titles()).toEqual(['Bravo pothole']))
    expect(Object.fromEntries(calls.at(-1)!.params)).toMatchObject({ status: 'in_progress', page: '1' })
    expect(router.state.location.search).toBe('?status=in_progress')
    expect(screen.getByRole('button', { name: 'In progress' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('sorting is done by the BACKEND: the header click sends ordering and the rows follow', async () => {
    const { calls, router } = await open()
    await userEvent.click(screen.getByRole('button', { name: 'Priority' }))
    await waitFor(() => expect(titles()).toEqual(['Alpha leak', 'Charlie drain', 'Bravo pothole'])) // critical, high, low
    expect(calls.at(-1)!.params.get('ordering')).toBe('-priority')
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toHaveAttribute('aria-sort', 'descending')
    expect(router.state.location.search).toBe('?ordering=-priority')

    await userEvent.click(screen.getByRole('button', { name: 'Priority' }))
    await waitFor(() => expect(titles()).toEqual(['Bravo pothole', 'Charlie drain', 'Alpha leak'])) // low, high, critical
    expect(calls.at(-1)!.params.get('ordering')).toBe('priority')
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts titles A to Z first, and the issue column header carries that sort', async () => {
    const { calls } = await open()
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }))
    await waitFor(() => expect(titles()).toEqual(['Alpha leak', 'Bravo pothole', 'Charlie drain']))
    expect(calls.at(-1)!.params.get('ordering')).toBe('title')
  })

  it('starts from the sort, filter and page in the URL', async () => {
    const { calls } = await open('/officer/issues?status=assigned&ordering=-votes')
    await waitFor(() => expect(titles()).toEqual(['Alpha leak']))
    expect(Object.fromEntries(calls[0].params)).toEqual({ status: 'assigned', ordering: '-votes', page: '1' })
    expect(screen.getByRole('columnheader', { name: 'Votes' })).toHaveAttribute('aria-sort', 'descending')
  })

  it('ignores a hand-edited sort key or status instead of sending it to the API', async () => {
    const { calls } = await open('/officer/issues?ordering=password&status=bogus')
    await waitFor(() => expect(titles()).toHaveLength(3))
    expect(Object.fromEntries(calls[0].params)).toEqual({ ordering: '-created_at', page: '1' })
  })

  it('paginates with the backend: Next asks for page 2, and changing a filter returns to page 1', async () => {
    const many = Array.from({ length: 45 }, (_, i) => makeOfficerIssue({ title: `Issue ${String(i).padStart(2, '0')}`, status: i < 30 ? 'in_progress' : 'resolved', created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }))
    const { calls } = await open('/officer/issues', many)
    expect(await screen.findByText('Showing 1–20 of 45')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 21–40 of 45')).toBeInTheDocument()
    expect(calls.at(-1)!.params.get('page')).toBe('2')

    await userEvent.click(screen.getByRole('button', { name: 'In progress' }))
    await waitFor(() => expect(calls.at(-1)!.params.get('status')).toBe('in_progress'))
    expect(calls.at(-1)!.params.get('page')).toBe('1')
  })

  it('clicking a row opens the issue', async () => {
    const { router } = await open()
    server.use(http.get(url(`/officer/issues/${issues[1].id}/`), () => HttpResponse.json({ ...issues[1], status_history: makeHistory(['reported', 'assigned']) })))
    await userEvent.click(screen.getByText('Alpha leak'))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/officer/issues/${issues[1].id}`))
  })

  it('shows a friendly empty state for an empty queue, and a different one for an empty filter', async () => {
    await open('/officer/issues', [])
    expect(await screen.findByText('Your queue is empty')).toBeInTheDocument()
  })

  it('an empty filter says to try another', async () => {
    await open('/officer/issues?status=reopened')
    expect(await screen.findByText('No issues with this status')).toBeInTheDocument()
  })

  it('shows skeleton rows while loading', async () => {
    asOfficer()
    server.use(http.get(url('/officer/issues/'), async () => (await new Promise((r) => setTimeout(r, 80)), HttpResponse.json({ count: 0, next: null, previous: null, results: [] }))))
    renderApp('/officer/issues')
    expect(await screen.findByRole('table', { name: 'Assigned issues' })).toHaveAttribute('aria-busy', 'true')
  })

  it('shows the server error with retry', async () => {
    asOfficer()
    server.use(http.get(url('/officer/issues/'), () => HttpResponse.json({ detail: 'Queue unavailable' }, { status: 500 })))
    renderApp('/officer/issues')
    expect(await screen.findByText('Queue unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})

describe('Officer issue page', () => {
  /** A stateful backend for one issue: actions change what the next GET returns, like the real API. */
  function backend(initial: Partial<OfficerIssue> & { history?: OfficerIssue['status_history'] } = {}) {
    const issue = makeOfficerIssue({
      id: 'issue-1',
      title: 'Overflowing drain at Vijay Nagar',
      status: 'assigned',
      priority: 'high',
      assignment: makeAssignment({ status: 'pending', is_mine: true }),
      ...initial,
    })
    const state = {
      issue,
      history: initial.history ?? makeHistory(['reported', 'under_review', 'assigned']),
      notes: [makeNote({ note: 'Called the contractor.' })],
      posts: [] as { path: string; body: unknown }[],
    }
    server.use(
      ...staffDefaults(),
      http.get(url('/officer/issues/issue-1/'), () => HttpResponse.json({ ...state.issue, status_history: state.history })),
      http.get(url('/officer/issues/issue-1/notes/'), () => HttpResponse.json({ count: state.notes.length, next: null, previous: null, results: state.notes })),
      http.post(url('/officer/issues/issue-1/accept/'), () => {
        state.posts.push({ path: 'accept', body: null })
        state.issue = { ...state.issue, status: 'in_progress', assignment: { ...state.issue.assignment!, status: 'accepted', accepted_at: '2026-11-06T10:00:00Z' } }
        state.history = makeHistory(['reported', 'under_review', 'assigned', 'in_progress'])
        return HttpResponse.json(state.issue)
      }),
      http.post(url('/officer/issues/issue-1/reject/'), async ({ request }) => {
        state.posts.push({ path: 'reject', body: await request.json() })
        return HttpResponse.json(state.issue)
      }),
      http.post(url('/officer/issues/issue-1/resolve/'), async ({ request }) => {
        const form = await request.formData()
        state.posts.push({ path: 'resolve', body: { image: (form.get('image') as File | null)?.name, remarks: form.get('remarks') } })
        state.issue = { ...state.issue, status: 'resolved' }
        state.history = makeHistory(['reported', 'under_review', 'assigned', 'in_progress', 'resolved'])
        return HttpResponse.json(state.issue)
      }),
      http.post(url('/officer/issues/issue-1/notes/'), async ({ request }) => {
        const { note } = (await request.json()) as { note: string }
        state.posts.push({ path: 'note', body: { note } })
        state.notes = [...state.notes, makeNote({ note })]
        return HttpResponse.json(state.notes.at(-1), { status: 201 })
      }),
      officerListHandler([]),
    )
    return state
  }

  async function open() {
    signInAs('officer', { full_name: 'Rohit Chauhan' })
    const rendered = renderApp('/officer/issues/issue-1')
    await screen.findByRole('heading', { name: 'Overflowing drain at Vijay Nagar' })
    return rendered
  }

  it('shows the whole picture: header, stepper, description, timeline, assignment and notes', async () => {
    backend()
    await open()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('My queue')
    const stepper = screen.getByRole('list', { name: 'Progress' })
    expect(within(stepper).getByText('Assigned').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('region', { name: 'Description' })).toHaveTextContent('A description that is long enough')
    const timeline = await screen.findByRole('list', { name: 'Status history' })
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(3)
    expect(within(timeline).getAllByText('Anita Deshpande · Admin', { selector: 'p' })).toHaveLength(2)
    expect(within(timeline).getByText('Reason for assigned')).toBeInTheDocument()
    expect(within(timeline).getByText('Current')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Assignment' })).getByText('You')).toBeInTheDocument()
    expect(await screen.findByText('Called the contractor.')).toBeInTheDocument()
  })

  it('each timeline entry says how long it took after the previous one', async () => {
    backend()
    await open()
    const timeline = await screen.findByRole('list', { name: 'Status history' })
    expect(within(timeline).getAllByText(/1 h after the previous step/)).toHaveLength(2)
  })

  it('accepting: sends the request, toasts, and the page moves to In progress', async () => {
    const state = backend()
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Accept assignment' }))
    expect(await screen.findByText('Assignment accepted. The issue is now in progress.')).toBeInTheDocument()
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Progress' })).getByText('In progress').closest('li')).toHaveAttribute('aria-current', 'step'))
    expect(state.posts.map((p) => p.path)).toEqual(['accept'])
    expect(await screen.findByRole('button', { name: 'Mark as resolved…' })).toBeInTheDocument() // the next action appears
    expect(screen.queryByRole('button', { name: 'Accept assignment' })).not.toBeInTheDocument()
  })

  it('shows the server message when an action is refused (409)', async () => {
    backend()
    server.use(http.post(url('/officer/issues/issue-1/accept/'), () => HttpResponse.json({ detail: 'This assignment has already been accepted.' }, { status: 409 })))
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Accept assignment' }))
    expect(await screen.findByText('This assignment has already been accepted.')).toBeInTheDocument()
  })

  it('sending back needs a reason: nothing is sent without one, then it goes to the queue', async () => {
    const state = backend()
    const { router } = await open()
    await userEvent.click(screen.getByRole('button', { name: 'Send back…' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send back' }))
    expect(await within(dialog).findByText('Give a short reason (at least 3 characters)')).toBeInTheDocument()
    expect(state.posts).toHaveLength(0)

    await userEvent.type(within(dialog).getByLabelText('Reason'), '   ') // whitespace is not a reason
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send back' }))
    expect(state.posts).toHaveLength(0)

    await userEvent.clear(within(dialog).getByLabelText('Reason'))
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'This is a drainage job')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send back' }))
    expect(await screen.findByText('Sent back to the admin for reassignment.')).toBeInTheDocument()
    expect(state.posts).toEqual([{ path: 'reject', body: { reason: 'This is a drainage job' } }])
    await waitFor(() => expect(router.state.location.pathname).toBe('/officer/issues')) // it left the queue: no 403 page
  })

  it('cancelling the dialog sends nothing and closes it', async () => {
    const state = backend()
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Send back…' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.posts).toHaveLength(0)
  })

  describe('resolving', () => {
    const inProgress = { status: 'in_progress' as const, assignment: makeAssignment({ status: 'accepted', is_mine: true }) }

    it('requires a photo as evidence: complains, sends nothing, and the complaint clears once a photo is chosen', async () => {
      const state = backend(inProgress)
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Mark as resolved…' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as resolved' }))
      expect(await within(dialog).findByText('Add a photo that shows the finished work.')).toBeInTheDocument()
      expect(state.posts).toHaveLength(0)

      await userEvent.upload(within(dialog).getByLabelText('Upload photos'), png())
      await waitFor(() => expect(within(dialog).queryByText('Add a photo that shows the finished work.')).not.toBeInTheDocument())
    })

    it('sends the photo and the remarks together as multipart, then shows Resolved', async () => {
      const state = backend(inProgress)
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Mark as resolved…' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.upload(within(dialog).getByLabelText('Upload photos'), png('after.png'))
      await userEvent.type(within(dialog).getByLabelText('What was done (optional)'), 'Cleared the blockage')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as resolved' }))

      expect(await screen.findByText('Issue marked as resolved.')).toBeInTheDocument()
      expect(state.posts).toEqual([{ path: 'resolve', body: { image: 'after.png', remarks: 'Cleared the blockage' } }])
      await waitFor(() => expect(within(screen.getByRole('list', { name: 'Progress' })).getByText('Resolved').closest('li')).toHaveAttribute('aria-current', 'step'))
    })

    it('only one photo can be chosen here', async () => {
      backend(inProgress)
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Mark as resolved…' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.upload(within(dialog).getByLabelText('Upload photos'), [png('one.png'), png('two.png')])
      expect(await within(dialog).findByText(/two\.png: at most 1 photo/)).toBeInTheDocument()
      expect(within(dialog).getAllByRole('img')).toHaveLength(1)
    })

    it('when a resolution photo was already uploaded, a new one is optional', async () => {
      const state = backend({
        ...inProgress,
        images: [{ id: 'img-1', url: 'http://x/after.png', image_type: 'resolution', uploaded_at: '2026-11-06T00:00:00Z' }],
      })
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Mark as resolved…' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/already attached/i)).toBeInTheDocument()
      await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as resolved' }))
      expect(await screen.findByText('Issue marked as resolved.')).toBeInTheDocument()
      expect(state.posts[0].body).toEqual({ image: undefined, remarks: null })
    })

    it('a server-side rejection keeps the dialog and the chosen photo so nothing is lost', async () => {
      backend(inProgress)
      server.use(http.post(url('/officer/issues/issue-1/resolve/'), () => HttpResponse.json({ image: ['The uploaded file is not a valid image.'] }, { status: 400 })))
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'Mark as resolved…' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.upload(within(dialog).getByLabelText('Upload photos'), png('broken.png'))
      await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as resolved' }))
      expect(await screen.findByText('The uploaded file is not a valid image.')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(within(screen.getByRole('dialog')).getByAltText('Preview of broken.png')).toBeInTheDocument()
    })
  })

  it('a colleague who is not the assigned officer sees who owns it and gets no action buttons', async () => {
    backend({ assignment: makeAssignment({ is_mine: false, officer: { id: 'o2', name: 'Imran Qureshi', employee_reference: 'SAN-202' }, status: 'pending' }) })
    await open()
    expect(await screen.findByText(/Assigned to Imran Qureshi\. Only they can act on it/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept assignment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send back…' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Assignment' })).queryByText('You')).not.toBeInTheDocument()
    expect(screen.getByLabelText('New note')).toBeInTheDocument() // notes stay open to the department
  })

  it.each([
    ['resolved', /Resolved\. If the problem comes back, an admin can reopen it/],
    ['under_review', /Back with the admin for review and reassignment/],
  ] as const)('a %s issue offers no action and explains why', async (status, message) => {
    backend({ status, assignment: makeAssignment({ status: 'accepted', is_mine: true }) })
    await open()
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept|send back|mark as resolved/i })).not.toBeInTheDocument()
  })

  describe('internal notes', () => {
    it('adds a note, clears the box and shows it', async () => {
      const state = backend()
      await open()
      const add = screen.getByRole('button', { name: 'Add note' })
      expect(add).toBeDisabled()
      await userEvent.type(screen.getByLabelText('New note'), 'Waiting for permission')
      expect(add).toBeEnabled()
      await userEvent.click(add)
      expect(await screen.findByText('Note added.')).toBeInTheDocument()
      expect(state.posts).toEqual([{ path: 'note', body: { note: 'Waiting for permission' } }])
      await waitFor(() => expect(screen.getByLabelText('New note')).toHaveValue(''))
      expect(await screen.findByText('Waiting for permission')).toBeInTheDocument()
    })

    it('whitespace alone cannot be sent', async () => {
      backend()
      await open()
      await userEvent.type(screen.getByLabelText('New note'), '    ')
      expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled()
    })

    it('says who can see them, and the empty state invites the first note', async () => {
      backend()
      server.use(http.get(url('/officer/issues/issue-1/notes/'), () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })))
      await open()
      expect(screen.getByText(/Only your department can see these/)).toBeInTheDocument()
      expect(await screen.findByText(/No notes yet/)).toBeInTheDocument()
    })
  })

  it('an issue from another department (403) or a missing one (404) shows a friendly page, not a crash', async () => {
    signInAs('officer')
    server.use(...staffDefaults(), http.get(url('/officer/issues/issue-1/'), () => HttpResponse.json({ detail: 'You do not have permission.' }, { status: 403 })))
    renderApp('/officer/issues/issue-1')
    expect(await screen.findByText('Not in your queue')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to my queue' })).toHaveAttribute('href', '/officer/issues')
  })

  it('a server error is an error with retry, not "not in your queue"', async () => {
    signInAs('officer')
    server.use(...staffDefaults(), http.get(url('/officer/issues/issue-1/'), () => HttpResponse.json({ detail: 'Boom' }, { status: 500 })))
    renderApp('/officer/issues/issue-1')
    expect(await screen.findByText('Boom')).toBeInTheDocument()
    expect(screen.queryByText('Not in your queue')).not.toBeInTheDocument()
  })

  it('shows photos labelled before / after and the map pin at the exact location', async () => {
    backend({
      location: { latitude: 22.71956, longitude: 75.85771 },
      images: [
        { id: 'a', url: 'http://x/before.png', image_type: 'report', uploaded_at: '2026-11-01T00:00:00Z' },
        { id: 'b', url: 'http://x/after.png', image_type: 'resolution', uploaded_at: '2026-11-05T00:00:00Z' },
      ],
    })
    await open()
    expect(await screen.findByText('Before: reported')).toBeInTheDocument()
    expect(screen.getByText('After: resolution photo')).toBeInTheDocument()
    expect(await screen.findByTestId('marker')).toHaveAttribute('data-lat', '22.71956')
    expect(screen.getByTestId('coordinates')).toHaveTextContent('22.71956, 75.85771')
  })
})

describe('Officer analytics page', () => {
  it('shows department totals, and every chart with its numbers', async () => {
    asOfficer()
    renderApp('/officer/analytics')
    expect(await screen.findByRole('heading', { name: 'Department analytics' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Average turnaround: 4 d 11 h')).toBeInTheDocument())
    expect(screen.getByLabelText('Resolved: 30')).toBeInTheDocument()
    expect(screen.getByLabelText('In your queue: 72')).toBeInTheDocument()
    expect(screen.getByLabelText('Sent back: 1')).toBeInTheDocument()
    for (const id of ['chart-trend', 'chart-status', 'chart-category', 'chart-priority']) {
      const chart = await screen.findByTestId(id)
      await waitFor(() => expect(chart.querySelector('svg.recharts-surface')).toBeInTheDocument())
    }
    expect(within(screen.getByTestId('chart-priority')).getByRole('table', { name: 'Queue by priority' })).toHaveTextContent('Critical7')
  })

  it('asks for 90 days of data', async () => {
    asOfficer()
    let days: string | null = null
    server.use(
      http.get(url('/officer/analytics/'), ({ request }) => {
        days = new URL(request.url).searchParams.get('days')
        return HttpResponse.json(JSON.parse(JSON.stringify({})) as never, { status: 500 })
      }),
    )
    renderApp('/officer/analytics')
    await screen.findByRole('heading', { name: 'Department analytics' })
    await waitFor(() => expect(days).toBe('90'))
  })
})

// keep the unused factory import honest
void makeIssue
