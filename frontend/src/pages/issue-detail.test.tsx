import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CATEGORIES, makeIssue } from '@/test/factories'
import { resetLeafletMock } from '@/test/leafletMock'
import { server } from '@/test/server'
import { renderApp, signInAs, url } from '@/test/utils'

vi.mock('react-leaflet', async () => (await import('@/test/leafletMock')).reactLeafletMock)
vi.mock('react-leaflet-cluster', async () => (await import('@/test/leafletMock')).clusterMock)

beforeEach(resetLeafletMock)

function mockIssue(issue = makeIssue({ id: 'issue-7' }), status = 200) {
  server.use(
    http.get(url(`/issues/${issue.id}/`), () =>
      status === 200 ? HttpResponse.json(issue) : HttpResponse.json({ detail: 'Not found.' }, { status }),
    ),
    http.get(url('/categories/'), () => HttpResponse.json(CATEGORIES)),
  )
  return issue
}

describe('Issue detail page', () => {
  it('is public and shows the whole issue', async () => {
    mockIssue(
      makeIssue({
        id: 'issue-7',
        title: 'Open manhole on Station Road',
        description: 'Line one of the description.\nLine two.',
        status: 'in_progress',
        priority: 'high',
        reference_number: 'CF-2611-ABC123',
        address: 'Station Road',
        landmark: 'City bus stand',
        vote_count: 12,
        comment_count: 4,
        moderation_status: undefined,
        is_mine: false,
        location: { latitude: 22.71956, longitude: 75.85771 },
      }),
    )
    const { router } = renderApp('/issues/issue-7')

    expect(await screen.findByRole('heading', { name: 'Open manhole on Station Road' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/issues/issue-7') // no login redirect
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('High priority')).toBeInTheDocument()
    expect(screen.getByText('CF-2611-ABC123')).toBeInTheDocument()
    expect(screen.getByText(/Line one of the description/)).toBeInTheDocument()
    expect(screen.getByText(/Station Road · Near City bus stand/)).toBeInTheDocument()
    const stats = screen.getByText('Votes').closest('div')!
    expect(within(stats).getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Comments').closest('div')).toHaveTextContent('4')
  })

  it('shows a small map with a pin at the issue exact location', async () => {
    mockIssue(makeIssue({ id: 'issue-7', location: { latitude: 22.71956, longitude: 75.85771 }, category: CATEGORIES[1] }))
    renderApp('/issues/issue-7')

    expect(await screen.findByRole('region', { name: /issue location/i })).toBeInTheDocument()
    const marker = await screen.findByTestId('marker')
    expect(marker).toHaveAttribute('data-lat', '22.71956')
    expect(marker).toHaveAttribute('data-lng', '75.85771')
    expect(screen.getByTestId('coordinates')).toHaveTextContent('22.71956, 75.85771')
  })

  it('shows photos, labelling resolution photos', async () => {
    mockIssue(
      makeIssue({
        id: 'issue-7',
        title: 'Fixed pothole',
        status: 'resolved',
        resolved_at: '2026-11-05T10:00:00+05:30',
        images: [
          { id: 'a', url: 'http://x/before.png', image_type: 'report', uploaded_at: '2026-11-01T00:00:00Z' },
          { id: 'b', url: 'http://x/after.png', image_type: 'resolution', uploaded_at: '2026-11-05T00:00:00Z' },
        ],
      }),
    )
    renderApp('/issues/issue-7')
    expect(await screen.findByAltText('Photo of Fixed pothole')).toHaveAttribute('src', 'http://x/before.png')
    expect(screen.getByAltText('Resolution photo for Fixed pothole')).toHaveAttribute('src', 'http://x/after.png')
    expect(screen.getByText('Resolution photo')).toBeInTheDocument()
    expect(screen.getByText('Resolved', { selector: 'dt' })).toBeInTheDocument()
  })

  it('tells the owner a pending report is not public yet', async () => {
    signInAs('citizen')
    mockIssue(makeIssue({ id: 'issue-7', moderation_status: 'pending', is_mine: true }))
    renderApp('/issues/issue-7')
    expect(await screen.findByText(/only you can see this report/i)).toBeInTheDocument()
  })

  it('tells the owner a rejected report was not approved', async () => {
    signInAs('citizen')
    mockIssue(makeIssue({ id: 'issue-7', moderation_status: 'rejected', status: 'rejected' }))
    renderApp('/issues/issue-7')
    expect(await screen.findByText(/was not approved for public listing/i)).toBeInTheDocument()
  })

  it('shows "not found" for an issue the API hides (404), with a way back', async () => {
    mockIssue(makeIssue({ id: 'issue-7' }), 404)
    renderApp('/issues/issue-7')
    expect(await screen.findByText('Issue not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explore issues' })).toHaveAttribute('href', '/explore')
  })

  it('shows an error with retry for server failures (not "not found")', async () => {
    let attempts = 0
    server.use(
      http.get(url('/issues/issue-7/'), () => {
        attempts++
        return attempts === 1 ? HttpResponse.json({ detail: 'Boom' }, { status: 500 }) : HttpResponse.json(makeIssue({ id: 'issue-7', title: 'Recovered' }))
      }),
    )
    renderApp('/issues/issue-7')
    expect(await screen.findByText('Boom')).toBeInTheDocument()
    expect(screen.queryByText('Issue not found')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('heading', { name: 'Recovered' })).toBeInTheDocument()
  })

  it('shows a loading state first', async () => {
    mockIssue()
    renderApp('/issues/issue-7')
    expect(screen.getByRole('status', { name: 'Loading issue' })).toBeInTheDocument()
    await screen.findByRole('heading', { level: 1 })
  })

  it('"View details" on a map popup lands here, and Back returns to the map', async () => {
    const issue = makeIssue({ id: 'issue-7', title: 'From the map', moderation_status: undefined, is_mine: false, status: 'in_progress' })
    server.use(
      http.get(url('/categories/'), () => HttpResponse.json(CATEGORIES)),
      http.get(url('/issues/'), () => HttpResponse.json({ count: 1, next: null, previous: null, results: [issue] })),
      http.get(url('/issues/issue-7/'), () => HttpResponse.json(issue)),
    )
    const { router } = renderApp('/explore?view=map')
    await userEvent.click(await screen.findByRole('link', { name: 'View details' }))
    expect(await screen.findByRole('heading', { name: 'From the map' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/issues/issue-7')

    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByRole('heading', { name: 'Explore issues' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?view=map')
  })

  it('Back goes to Explore when the page was opened directly', async () => {
    mockIssue()
    server.use(http.get(url('/issues/'), () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })))
    const { router } = renderApp('/issues/issue-7')
    await userEvent.click(await screen.findByRole('button', { name: /back/i }))
    expect(await screen.findByRole('heading', { name: 'Explore issues' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/explore')
  })
})
