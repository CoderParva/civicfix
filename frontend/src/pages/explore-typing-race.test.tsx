import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CATEGORIES, makePublicIssues } from '@/test/factories'
import { resetLeafletMock } from '@/test/leafletMock'
import { server } from '@/test/server'
import { publicIssuesHandler, renderApp, url } from '@/test/utils'

vi.mock('react-leaflet', async () => (await import('@/test/leafletMock')).reactLeafletMock)
vi.mock('react-leaflet-cluster', async () => (await import('@/test/leafletMock')).clusterMock)

beforeEach(resetLeafletMock)

/**
 * The Explore filters live in the URL, and the router reports a new URL back to React *later* than the click
 * that asked for it (React Router applies navigations in a transition, so on a slow or busy page that is
 * tens to hundreds of milliseconds). Whatever a person does in that gap must survive it.
 * These tests make the gap explicit and long: every navigation is delayed by LAG ms.
 */
const LAG = 150

function backend() {
  server.use(
    http.get(url('/categories/'), () => HttpResponse.json(CATEGORIES)),
    publicIssuesHandler(makePublicIssues(45), () => {}),
  )
}

async function openSlowExplore(search: string) {
  backend()
  const rendered = renderApp(`/explore${search}`)
  await screen.findByRole('heading', { name: 'Explore issues' })
  await screen.findByText(/Showing 1–20 of 45 issues|No issues found/)
  const original = rendered.router.navigate.bind(rendered.router)
  rendered.router.navigate = ((...args: Parameters<typeof original>) =>
    new Promise((resolve) => setTimeout(() => resolve(original(...args)), LAG))) as typeof original
  return rendered
}

const search = () => screen.getByLabelText('Search') as HTMLInputElement
const status = () => screen.getByLabelText('Status') as HTMLSelectElement
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, LAG * 3)))

describe('Explore filters: typing right after a click is never lost, however slowly the URL catches up', () => {
  it('Clear filters, then straight away type something new: the new text stays and the cleared filters do not come back', async () => {
    const { router } = await openSlowExplore('?status=resolved&q=old')
    expect(search().value).toBe('old')

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(search().value).toBe('') // the box empties at once; it does not wait for the router
    expect(status().value).toBe('')

    await userEvent.type(search(), 'new')
    await settle()

    expect(search().value).toBe('new')
    expect(status().value).toBe('') // a stale copy of the old filters must not be written back
    expect(router.state.location.search).toBe('?q=new')
  })

  it('typing the SAME text that was there before the clear still registers (the box really was emptied)', async () => {
    const { router } = await openSlowExplore('?q=pump')
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    fireEvent.change(search(), { target: { value: 'pump' } }) // what an automated fill (or a paste) does
    await settle()

    expect(search().value).toBe('pump')
    expect(router.state.location.search).toBe('?q=pump')
  })

  it('typing fast: every keystroke counts, and late echoes of earlier keystrokes do not overwrite later ones', async () => {
    const { router } = await openSlowExplore('')
    await userEvent.type(search(), 'water pump')
    expect(search().value).toBe('water pump')
    await settle()
    expect(search().value).toBe('water pump')
    expect(router.state.location.search).toBe('?q=water+pump')
  })

  it('changing a select and then typing straight away keeps both', async () => {
    const { router } = await openSlowExplore('')
    await userEvent.selectOptions(status(), 'resolved')
    await userEvent.type(search(), 'pump')
    await settle()
    expect(status().value).toBe('resolved')
    expect(search().value).toBe('pump')
    expect(router.state.location.search).toBe('?q=pump&status=resolved')
  })
})

describe('Explore filters: URL changes that did not come from this page are still followed', () => {
  it('back / forward / a link to a filtered view update the page', async () => {
    const { router } = await openSlowExplore('?q=first')
    await act(() => router.navigate('/explore?q=second&status=resolved'))
    await waitFor(() => expect(search().value).toBe('second'))
    expect(status().value).toBe('resolved')

    await act(() => router.navigate(-1))
    await waitFor(() => expect(search().value).toBe('first'))
    expect(status().value).toBe('')
  })

  it('after typing here, an outside navigation still wins (it is not mistaken for an echo)', async () => {
    const { router } = await openSlowExplore('')
    await userEvent.type(search(), 'abc')
    await settle()
    await act(() => router.navigate('/explore?q=elsewhere'))
    await waitFor(() => expect(search().value).toBe('elsewhere'))
  })
})
