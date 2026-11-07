import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CATEGORIES, makeIssue } from '@/test/factories'
import { clickMap, mapApi, resetLeafletMock } from '@/test/leafletMock'
import { server } from '@/test/server'
import { issuesListHandler, renderApp, signInAs, url } from '@/test/utils'

vi.mock('react-leaflet', async () => (await import('@/test/leafletMock')).reactLeafletMock)
vi.mock('react-leaflet-cluster', async () => (await import('@/test/leafletMock')).clusterMock)

beforeEach(resetLeafletMock)
afterEach(() => vi.unstubAllGlobals())

async function openForm() {
  signInAs('citizen')
  server.use(
    http.get(url('/categories/'), () => HttpResponse.json(CATEGORIES)),
    issuesListHandler([]),
  )
  renderApp('/report')
  await screen.findByRole('form', { name: /report an issue/i })
  await screen.findByRole('option', { name: 'Pothole' })
  await screen.findByTestId('map-container') // the lazily loaded picker
}

const marker = () => screen.queryByTestId('marker')
const lat = () => screen.getByLabelText('Latitude') as HTMLInputElement
const lng = () => screen.getByLabelText('Longitude') as HTMLInputElement

describe('Report form: map picker', () => {
  it('shows the map with no pin until there is a valid location', async () => {
    await openForm()
    expect(screen.getByRole('region', { name: /click to set the issue location/i })).toBeInTheDocument()
    expect(marker()).toBeNull()
  })

  it('click on the map drops the pin and fills latitude/longitude', async () => {
    await openForm()
    act(() => clickMap(22.724518, 75.883412))

    await waitFor(() => expect(lat().value).toBe('22.724518'))
    expect(lng().value).toBe('75.883412')
    expect(marker()).toHaveAttribute('data-lat', '22.724518')
    expect(marker()).toHaveAttribute('data-lng', '75.883412')
  })

  it('rounds the clicked point to 6 decimals', async () => {
    await openForm()
    act(() => clickMap(22.7245181234567, 75.8834129876543))
    await waitFor(() => expect(lat().value).toBe('22.724518'))
    expect(lng().value).toBe('75.883413')
  })

  it('a later click moves the pin and overwrites the fields', async () => {
    await openForm()
    act(() => clickMap(22.7, 75.8))
    await waitFor(() => expect(lat().value).toBe('22.700000'))
    act(() => clickMap(22.8, 75.9))
    await waitFor(() => expect(lat().value).toBe('22.800000'))
    expect(screen.getAllByTestId('marker')).toHaveLength(1)
    expect(marker()).toHaveAttribute('data-lat', '22.8')
  })

  it('typing coordinates moves the pin (manual entry still works)', async () => {
    await openForm()
    await userEvent.type(lat(), '22.71')
    expect(marker()).toBeNull() // longitude still empty: no half-baked pin
    await userEvent.type(lng(), '75.85')
    expect(marker()).toHaveAttribute('data-lat', '22.71')
    expect(marker()).toHaveAttribute('data-lng', '75.85')
  })

  it('invalid typed coordinates remove the pin instead of misplacing it', async () => {
    await openForm()
    act(() => clickMap(22.7, 75.8))
    await waitFor(() => expect(marker()).not.toBeNull())
    await userEvent.clear(lat())
    await userEvent.type(lat(), '123') // out of range
    expect(marker()).toBeNull()
    expect(await screen.findByDisplayValue('123')).toBeInTheDocument() // the user's text is untouched
  })

  it('"Use my current location" still fills the fields and puts the pin there', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 22.719568, longitude: 75.857727 } } as GeolocationPosition),
      },
    })
    await openForm()
    await userEvent.click(screen.getByRole('button', { name: /use my current location/i }))
    await waitFor(() => expect(lat().value).toBe('22.719568'))
    expect(marker()).toHaveAttribute('data-lng', '75.857727')
  })

  it('moves the view to a point that was entered outside what the map is showing', async () => {
    await openForm()
    mapApi.getBounds.mockReturnValue({ contains: vi.fn(() => false) })
    await userEvent.type(lat(), '12.97')
    await userEvent.type(lng(), '77.59')
    await waitFor(() => expect(mapApi.setView).toHaveBeenCalledWith([12.97, 77.59], expect.any(Number)))
  })

  it('all three ways combine: GPS, then a click, then a typed correction', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 22.5, longitude: 75.5 } } as GeolocationPosition) },
    })
    await openForm()
    await userEvent.click(screen.getByRole('button', { name: /use my current location/i }))
    await waitFor(() => expect(lat().value).toBe('22.500000'))
    act(() => clickMap(22.6, 75.6))
    await waitFor(() => expect(lat().value).toBe('22.600000'))
    await userEvent.clear(lat())
    await userEvent.type(lat(), '22.65')
    expect(marker()).toHaveAttribute('data-lat', '22.65')
    expect(marker()).toHaveAttribute('data-lng', '75.6')
  })

  it('submits the map-picked coordinates as numbers', async () => {
    let body: Record<string, unknown> = {}
    server.use(
      http.post(url('/issues/'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(makeIssue({ id: 'new', reference_number: 'CF-2611-MAP001' }), { status: 201 })
      }),
    )
    await openForm()
    await userEvent.type(screen.getByLabelText('Title'), 'Pinned on the map')
    await userEvent.type(screen.getByLabelText('Description'), 'Location was chosen by clicking the map.')
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Pothole')
    act(() => clickMap(22.724518, 75.883412))
    await waitFor(() => expect(lat().value).toBe('22.724518'))
    await userEvent.click(screen.getByRole('button', { name: /submit report/i }))

    await screen.findByRole('heading', { name: 'My reports' })
    expect(body).toMatchObject({ latitude: 22.724518, longitude: 75.883412, category: 1 })
  })

  it('a click after a failed validation clears the coordinate errors', async () => {
    await openForm()
    await userEvent.click(screen.getByRole('button', { name: /submit report/i }))
    expect(await screen.findByText('Latitude is required')).toBeInTheDocument()
    act(() => clickMap(22.7, 75.8))
    await waitFor(() => expect(screen.queryByText('Latitude is required')).not.toBeInTheDocument())
    expect(screen.queryByText('Longitude is required')).not.toBeInTheDocument()
  })
})
