import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CATEGORIES, makeIssue } from '@/test/factories'
import { mapApi, resetLeafletMock } from '@/test/leafletMock'

import { colorForCategory } from './categoryColors'
import MapView from './MapView'

vi.mock('react-leaflet', async () => (await import('@/test/leafletMock')).reactLeafletMock)
vi.mock('react-leaflet-cluster', async () => (await import('@/test/leafletMock')).clusterMock)

beforeEach(resetLeafletMock)

const pothole = CATEGORIES[0]
const garbage = CATEGORIES[1]

function renderMap(issues = [makeIssue()], categories = CATEGORIES) {
  return render(
    <MemoryRouter initialEntries={['/explore']}>
      <Routes>
        <Route path="/explore" element={<MapView issues={issues} categories={categories} />} />
        <Route path="/issues/:id" element={<h1>Detail page</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MapView', () => {
  it('draws one marker per issue, at its exact coordinates', () => {
    renderMap([
      makeIssue({ location: { latitude: 22.7196, longitude: 75.8577 } }),
      makeIssue({ location: { latitude: 22.75, longitude: 75.9 } }),
    ])
    const markers = screen.getAllByTestId('marker')
    expect(markers.map((m) => [m.dataset.lat, m.dataset.lng])).toEqual([
      ['22.7196', '75.8577'],
      ['22.75', '75.9'],
    ])
  })

  it('puts every marker inside the cluster group', () => {
    renderMap([makeIssue(), makeIssue(), makeIssue()])
    const group = screen.getByTestId('cluster-group')
    expect(within(group).getAllByTestId('marker')).toHaveLength(3)
  })

  it('colours markers by category, one colour per category', () => {
    renderMap([makeIssue({ category: pothole }), makeIssue({ category: pothole }), makeIssue({ category: garbage })])
    const [a, b, c] = screen.getAllByTestId('marker').map((m) => m.dataset.iconHtml)
    expect(a).toContain(colorForCategory(pothole.id))
    expect(b).toBe(a) // same category, same pin
    expect(c).toContain(colorForCategory(garbage.id))
    expect(c).not.toBe(a)
  })

  it('shows title, category, status and a "View details" link in each popup', () => {
    renderMap([makeIssue({ id: 'issue-42', title: 'Flooded underpass', category: garbage, status: 'in_progress' })])
    const popup = screen.getByTestId('popup')
    expect(within(popup).getByText('Flooded underpass')).toBeInTheDocument()
    expect(within(popup).getByText('Garbage')).toBeInTheDocument()
    expect(within(popup).getByText('In progress')).toBeInTheDocument()
    expect(within(popup).getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/issues/issue-42')
  })

  it('navigates client-side to the detail page (no full reload, so the in-memory token survives)', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderMap([makeIssue({ id: 'issue-42' })])
    await userEvent.click(screen.getByRole('link', { name: 'View details' }))
    expect(await screen.findByRole('heading', { name: 'Detail page' })).toBeInTheDocument()
  })

  it('renders user-written titles as text, never as HTML', () => {
    const hostile = '<img src=x onerror="window.__pwned=1">Click <b>me</b>'
    renderMap([makeIssue({ title: hostile })])
    const popup = screen.getByTestId('popup')
    expect(popup.textContent).toContain(hostile)
    expect(popup.querySelector('img')).toBeNull()
    expect(popup.querySelector('b')).toBeNull()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('zooms the map to fit all the markers', () => {
    renderMap([
      makeIssue({ location: { latitude: 22.7, longitude: 75.8 } }),
      makeIssue({ location: { latitude: 22.8, longitude: 75.9 } }),
    ])
    expect(mapApi.fitBounds).toHaveBeenCalledTimes(1)
    const [bounds, options] = mapApi.fitBounds.mock.calls[0]
    expect(bounds.getSouthWest()).toMatchObject({ lat: 22.7, lng: 75.8 })
    expect(bounds.getNorthEast()).toMatchObject({ lat: 22.8, lng: 75.9 })
    expect(options.maxZoom).toBe(15) // a lone pin must not zoom to street-level absurdity
    expect(options.animate).toBe(false) // an animation would outlive an unmounted map and throw
  })

  it('does not refit on every render, only when the set of issues changes', () => {
    const issues = [makeIssue(), makeIssue()]
    const { rerender } = render(
      <MemoryRouter>
        <MapView issues={issues} categories={CATEGORIES} />
      </MemoryRouter>,
    )
    rerender(
      <MemoryRouter>
        <MapView issues={[...issues]} categories={CATEGORIES} />
      </MemoryRouter>,
    )
    expect(mapApi.fitBounds).toHaveBeenCalledTimes(1)
    rerender(
      <MemoryRouter>
        <MapView issues={[...issues, makeIssue()]} categories={CATEGORIES} />
      </MemoryRouter>,
    )
    expect(mapApi.fitBounds).toHaveBeenCalledTimes(2)
  })

  it('shows no markers and does not try to fit bounds when there are no issues', () => {
    renderMap([])
    expect(screen.queryAllByTestId('marker')).toHaveLength(0)
    expect(mapApi.fitBounds).not.toHaveBeenCalled()
    expect(screen.queryByRole('list', { name: 'Map legend' })).not.toBeInTheDocument()
  })

  it('has a legend of the categories on the map, using the same colours as the pins', () => {
    renderMap([makeIssue({ category: pothole })])
    const legend = screen.getByRole('list', { name: 'Map legend' })
    expect(within(legend).getByText('Pothole')).toBeInTheDocument()
    expect(within(legend).queryByText('Garbage')).not.toBeInTheDocument() // none on the map
    const dot = legend.querySelector('span[aria-hidden]') as HTMLElement
    expect(dot.style.background).toBe(hexToRgb(colorForCategory(pothole.id)))
  })

  it('is an accessible map region', () => {
    renderMap()
    expect(screen.getByRole('region', { name: 'Map of issues' })).toBeInTheDocument()
  })

  it('tells the user when the base map cannot draw (no WebGL) but still shows markers', () => {
    renderMap([makeIssue()])
    expect(screen.getByRole('status')).toHaveTextContent(/needs WebGL/i)
    expect(screen.getAllByTestId('marker')).toHaveLength(1)
  })
})

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
