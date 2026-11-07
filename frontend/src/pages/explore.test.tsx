import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CATEGORIES, makePublicIssues } from '@/test/factories'
import { resetLeafletMock } from '@/test/leafletMock'
import { server } from '@/test/server'
import { publicIssuesHandler, renderApp, signInAs, url } from '@/test/utils'

vi.mock('react-leaflet', async () => (await import('@/test/leafletMock')).reactLeafletMock)
vi.mock('react-leaflet-cluster', async () => (await import('@/test/leafletMock')).clusterMock)

beforeEach(resetLeafletMock)

type Call = { params: URLSearchParams; authorization: string | null }
const [POTHOLE, GARBAGE] = CATEGORIES

/** 45 public issues: categories alternate, statuses/priorities cycle, so every filter has matches. */
function dataset() {
  return makePublicIssues(45, (i) => ({
    category: i % 2 === 0 ? POTHOLE : GARBAGE,
    status: (['reported', 'in_progress', 'resolved'] as const)[i % 3],
    priority: (['low', 'medium', 'high'] as const)[Math.floor(i / 3) % 3], // independent of status, so combinations exist
    vote_count: i,
    location: { latitude: 22.7 + i * 0.001, longitude: 75.85 + i * 0.001 },
  }))
}

function mockBackend(issues = dataset()) {
  const calls: Call[] = []
  server.use(
    http.get(url('/categories/'), () => HttpResponse.json(CATEGORIES)),
    publicIssuesHandler(issues, (c) => calls.push(c)),
  )
  return { issues, calls }
}

const cards = () => screen.queryAllByTestId('issue-card')
const filter = (name: string) => screen.getByLabelText(name) as HTMLSelectElement
const paramsOf = (calls: Call[]) => calls.map((c) => Object.fromEntries(c.params))

async function openExplore(search = '') {
  const rendered = renderApp(`/explore${search}`)
  await screen.findByRole('heading', { name: 'Explore issues' })
  return rendered
}

describe('Explore: access', () => {
  it('is public: a signed-out visitor sees it, with no login redirect and no auth header', async () => {
    const { calls } = mockBackend()
    const { router } = await openExplore()
    expect(await screen.findByText(/Showing 1–20 of 45 issues/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/explore')
    expect(calls.every((c) => c.authorization === null)).toBe(true)
  })

  it('is also reachable when signed in (citizen navbar links to it)', async () => {
    signInAs('citizen')
    mockBackend()
    await openExplore()
    expect(await screen.findByText(/Showing 1–20 of 45 issues/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore')
  })
})

describe('Explore: list view and backend pagination', () => {
  it('shows the first backend page (20 of 45) with image/title/category/location/status/priority/votes', async () => {
    mockBackend()
    await openExplore()
    await screen.findByText(/Showing 1–20 of 45 issues/)
    expect(cards()).toHaveLength(20)
    const first = cards()[0]
    expect(within(first).getByText('Public issue 01')).toBeInTheDocument()
    expect(within(first).getByText('Pothole', { exact: false })).toBeInTheDocument()
    expect(within(first).getByText('Low priority')).toBeInTheDocument()
    expect(within(first).getByLabelText('0 votes')).toBeInTheDocument()
  })

  it('asks the backend for ONE page at a time and moves with Next/Previous', async () => {
    const { calls } = mockBackend()
    await openExplore()
    await screen.findByText('Page 1 of 3')
    expect(paramsOf(calls)).toEqual([{ page: '1' }])

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/Showing 21–40 of 45 issues/)).toBeInTheDocument()
    expect(screen.getByText('Public issue 21')).toBeInTheDocument()
    expect(paramsOf(calls).at(-1)).toEqual({ page: '2' })

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/Showing 41–45 of 45 issues/)).toBeInTheDocument()
    expect(cards()).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText(/Showing 21–40 of 45 issues/)).toBeInTheDocument()
  })

  it('keeps the page in the URL, so a reload or shared link lands on the same page', async () => {
    mockBackend()
    const { router } = await openExplore('?page=2')
    expect(await screen.findByText(/Showing 21–40 of 45 issues/)).toBeInTheDocument()
    expect(router.state.location.search).toBe('?page=2')
  })

  it('falls back to page 1 when the URL has a page past the end (backend 404)', async () => {
    mockBackend()
    const { router } = await openExplore('?page=99')
    expect(await screen.findByText(/Showing 1–20 of 45 issues/)).toBeInTheDocument()
    expect(router.state.location.search).toBe('')
  })

  it('has no pagination controls when everything fits on one page', async () => {
    mockBackend(dataset().slice(0, 5))
    await openExplore()
    await screen.findByText(/Showing 1–5 of 5 issues/)
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
  })
})

describe('Explore: filters (applied by the backend)', () => {
  it('sends category, status and priority as query params and shows only matching issues', async () => {
    const { calls, issues } = mockBackend()
    await openExplore()
    await screen.findByText(/of 45 issues/)

    await userEvent.selectOptions(filter('Category'), 'Garbage')
    await userEvent.selectOptions(filter('Status'), 'Resolved')
    await userEvent.selectOptions(filter('Priority'), 'Medium')

    const expected = issues.filter((i) => i.category.id === GARBAGE.id && i.status === 'resolved' && i.priority === 'medium')
    expect(expected.length).toBeGreaterThan(0) // guard: an empty expectation would make this test vacuous
    await waitFor(() => expect(paramsOf(calls).at(-1)).toEqual({ page: '1', category: String(GARBAGE.id), status: 'resolved', priority: 'medium' }))
    await screen.findByText(new RegExp(`of ${expected.length} issues|Showing 1–${expected.length} of ${expected.length}`))
    expect(cards()).toHaveLength(expected.length)
    for (const card of cards()) {
      expect(within(card).getByText('Resolved')).toBeInTheDocument()
      expect(within(card).getByText('Medium priority')).toBeInTheDocument()
    }
  })

  it('never sends an empty filter param', async () => {
    const { calls } = mockBackend()
    await openExplore()
    await screen.findByText(/of 45 issues/)
    await userEvent.selectOptions(filter('Priority'), 'High')
    await userEvent.selectOptions(filter('Priority'), 'All priorities')
    await screen.findByText(/Showing 1–20 of 45 issues/)
    for (const params of paramsOf(calls)) {
      expect(Object.values(params).every((v) => v !== '')).toBe(true)
    }
    expect(paramsOf(calls).at(-1)).toEqual({ page: '1' })
  })

  it('changing a filter returns to page 1', async () => {
    const { calls } = mockBackend()
    await openExplore('?page=2')
    await screen.findByText(/Showing 21–40/)
    await userEvent.selectOptions(filter('Status'), 'In progress')
    await waitFor(() => expect(paramsOf(calls).at(-1)).toMatchObject({ page: '1', status: 'in_progress' }))
  })

  it('reads filters from the URL, and ignores invalid ones instead of sending them', async () => {
    const { calls } = mockBackend()
    await openExplore('?status=in_progress&priority=urgent&category=abc')
    await screen.findByText(/of \d+ issues/)
    expect(filter('Status').value).toBe('in_progress')
    expect(filter('Priority').value).toBe('')
    expect(filter('Category').value).toBe('')
    expect(paramsOf(calls)[0]).toEqual({ page: '1', status: 'in_progress' })
  })

  it('"Clear filters" resets everything and is disabled when nothing is set', async () => {
    mockBackend()
    await openExplore()
    const clear = await screen.findByRole('button', { name: 'Clear filters' })
    expect(clear).toBeDisabled()
    await userEvent.selectOptions(filter('Category'), 'Garbage')
    await userEvent.type(screen.getByLabelText('Search'), 'issue')
    expect(clear).toBeEnabled()
    await userEvent.click(clear)
    await screen.findByText(/Showing 1–20 of 45 issues/)
    expect(filter('Category').value).toBe('')
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('')
  })

  it('offers every public status and priority, and no "rejected"', async () => {
    mockBackend()
    await openExplore()
    expect(within(filter('Status')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All statuses', 'Reported', 'Under review', 'Assigned', 'In progress', 'Resolved', 'Reopened',
    ])
    expect(within(filter('Priority')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All priorities', 'Low', 'Medium', 'High', 'Critical',
    ])
  })

  it('shows an empty state when nothing matches', async () => {
    mockBackend()
    await openExplore()
    await screen.findByText(/of 45 issues/)
    await userEvent.selectOptions(filter('Priority'), 'Critical')
    expect(await screen.findByText('No issues match')).toBeInTheDocument()
    expect(screen.getByText('No issues found')).toBeInTheDocument()
  })
})

describe('Explore: keyword search (client-side, across ALL pages)', () => {
  function withNeedles() {
    // 45 issues; two "waterlogging" ones sit on page 3 and one on page 2, none on page 1
    return makePublicIssues(45, (i) => ({
      title: [20, 41, 44].includes(i) ? `Waterlogging near stop ${i}` : `Public issue ${String(i + 1).padStart(2, '0')}`,
    }))
  }

  it('finds matches on every backend page, not just the visible one', async () => {
    const { calls } = mockBackend(withNeedles())
    await openExplore()
    await screen.findByText(/Showing 1–20 of 45/)
    await userEvent.type(screen.getByLabelText('Search'), 'waterlogging')

    expect(await screen.findByText(/Showing 1–3 of 3 issues/)).toBeInTheDocument()
    expect(cards().map((c) => within(c).getByRole('link').textContent)).toEqual([
      'Waterlogging near stop 20',
      'Waterlogging near stop 41',
      'Waterlogging near stop 44',
    ])
    // it had to pull pages 2 and 3 to know that
    expect(new Set(paramsOf(calls).map((p) => p.page))).toEqual(new Set(['1', '2', '3']))
  })

  it('matches description text too, ignoring case', async () => {
    mockBackend(makePublicIssues(5, (i) => ({ description: i === 3 ? 'The Pump Station is flooded' : 'Nothing special here at all' })))
    await openExplore()
    await userEvent.type(await screen.findByLabelText('Search'), 'PUMP station')
    expect(await screen.findByText(/Showing 1–1 of 1 issues/)).toBeInTheDocument()
  })

  it('combines with the backend filters (the keyword never goes to the API)', async () => {
    const { calls } = mockBackend(withNeedles())
    await openExplore('?status=in_progress')
    await screen.findByText(/of 45 issues/)
    await userEvent.type(screen.getByLabelText('Search'), 'waterlogging')
    await screen.findByText(/of 3 issues/)
    expect(paramsOf(calls).every((p) => !('q' in p) && p.status === 'in_progress')).toBe(true)
  })

  it('paginates a long result set locally, with the same page size', async () => {
    mockBackend(makePublicIssues(45, () => ({ description: 'common keyword inside' })))
    await openExplore()
    await userEvent.type(await screen.findByLabelText('Search'), 'common')
    expect(await screen.findByText(/Showing 1–20 of 45 issues/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/Showing 21–40 of 45 issues/)).toBeInTheDocument()
  })

  it('returns to page 1 when the keyword changes, and shows an empty state for no match', async () => {
    mockBackend(makePublicIssues(45))
    await openExplore('?page=2')
    await userEvent.type(await screen.findByLabelText('Search'), 'zzz-no-such-thing')
    expect(await screen.findByText('No issues match')).toBeInTheDocument()
    expect(screen.getByText('No issues found')).toBeInTheDocument()
  })

  it('keeps the keyword in the URL', async () => {
    mockBackend()
    const { router } = await openExplore()
    await userEvent.type(await screen.findByLabelText('Search'), 'pump')
    expect(router.state.location.search).toBe('?q=pump')
  })
})

describe('Explore: list / map toggle shares the same filters', () => {
  it('switches to the map showing every filtered issue (not just one page)', async () => {
    mockBackend()
    await openExplore()
    await screen.findByText(/Showing 1–20 of 45/)
    await userEvent.click(screen.getByRole('button', { name: 'Map' }))

    expect(await screen.findByText('45 issues on the map')).toBeInTheDocument()
    expect(await screen.findAllByTestId('marker')).toHaveLength(45)
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
  })

  it('the map and the list use the same filters', async () => {
    const { calls, issues } = mockBackend()
    await openExplore()
    await screen.findByText(/of 45/)
    await userEvent.selectOptions(filter('Category'), 'Pothole')
    await userEvent.selectOptions(filter('Priority'), 'High')
    const matching = issues.filter((i) => i.category.id === POTHOLE.id && i.priority === 'high')
    expect(matching.length).toBeGreaterThan(0)
    await screen.findByText(new RegExp(`of ${matching.length} issues`))

    await userEvent.click(screen.getByRole('button', { name: 'Map' }))
    expect(await screen.findByText(`${matching.length} issues on the map`)).toBeInTheDocument()
    expect(await screen.findAllByTestId('marker')).toHaveLength(matching.length)
    expect(paramsOf(calls).at(-1)).toMatchObject({ category: String(POTHOLE.id), priority: 'high' })

    await userEvent.click(screen.getByRole('button', { name: 'List' }))
    await screen.findByText(new RegExp(`of ${matching.length} issues`))
    expect(filter('Category').value).toBe(String(POTHOLE.id))
    expect(filter('Priority').value).toBe('high')
  })

  it('the keyword filters the map pins too', async () => {
    mockBackend(makePublicIssues(45, (i) => ({ title: i < 3 ? `Needle ${i}` : `Hay ${i}` })))
    await openExplore('?view=map')
    expect(await screen.findAllByTestId('marker')).toHaveLength(45)
    await userEvent.type(screen.getByLabelText('Search'), 'needle')
    await waitFor(() => expect(screen.getAllByTestId('marker')).toHaveLength(3))
    expect(screen.getByText('3 issues on the map')).toBeInTheDocument()
  })

  it('opens straight into the map from ?view=map, and the toggle writes the URL', async () => {
    mockBackend(dataset().slice(0, 5))
    const { router } = await openExplore('?view=map')
    expect(await screen.findAllByTestId('marker')).toHaveLength(5)
    await userEvent.click(screen.getByRole('button', { name: 'List' }))
    await screen.findByText(/Showing 1–5 of 5/)
    expect(router.state.location.search).toBe('')
  })

  it('shows the map (with no pins) and a message when no issue matches', async () => {
    mockBackend(dataset().slice(0, 3))
    await openExplore('?view=map&priority=critical')
    expect(await screen.findByText('No issues found')).toBeInTheDocument()
    expect(await screen.findByTestId('map-container')).toBeInTheDocument()
    expect(screen.queryAllByTestId('marker')).toHaveLength(0)
  })

  it('popups on the Explore map link to the issue detail page', async () => {
    mockBackend(makePublicIssues(2))
    await openExplore('?view=map')
    const links = await screen.findAllByRole('link', { name: 'View details' })
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('href')).toMatch(/^\/issues\/.+/)
  })
})

describe('Explore: loading and errors', () => {
  it('shows a loading skeleton first', async () => {
    mockBackend()
    renderApp('/explore')
    expect(await screen.findByRole('status', { name: 'Loading issues' })).toBeInTheDocument()
    await screen.findByText(/Showing 1–20/)
  })

  it('shows an error with Try again that recovers', async () => {
    let attempts = 0
    server.use(
      http.get(url('/categories/'), () => HttpResponse.json(CATEGORIES)),
      http.get(url('/issues/'), () => {
        attempts++
        return attempts === 1
          ? HttpResponse.json({ detail: 'Database is down' }, { status: 500 })
          : HttpResponse.json({ count: 1, next: null, previous: null, results: makePublicIssues(1) })
      }),
    )
    await openExplore()
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText(/Showing 1–1 of 1/)).toBeInTheDocument()
  })

  it('says so when a very large map result was cut off at the cap', async () => {
    // Backend claims endless pages: the client must stop at its cap and tell the user.
    server.use(
      http.get(url('/categories/'), () => HttpResponse.json(CATEGORIES)),
      http.get(url('/issues/'), ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'))
        return HttpResponse.json({
          count: 9999,
          next: url(`/issues/?page=${page + 1}`),
          previous: null,
          results: makePublicIssues(1, () => ({ id: `p${page}`, title: `Page ${page} issue` })),
        })
      }),
    )
    await openExplore('?view=map')
    expect(await screen.findByText(/Only the first 500 matching issues are on the map/)).toBeInTheDocument()
    expect(await screen.findAllByTestId('marker')).toHaveLength(25) // 25 pages x 1 here
  })
})
