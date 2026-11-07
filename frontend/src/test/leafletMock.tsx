/**
 * A stand-in for react-leaflet (and the cluster plugin) for tests of OUR logic: which markers are
 * drawn, what the popups say, what a map click does. Leaflet itself is DOM/size-heavy, so the real
 * thing is exercised in the browser E2E instead.
 *
 * Use it in a test file with:
 *   vi.mock('react-leaflet', async () => (await import('@/test/leafletMock')).reactLeafletMock)
 *   vi.mock('react-leaflet-cluster', async () => (await import('@/test/leafletMock')).clusterMock)
 */
import type { ReactNode } from 'react'
import { vi } from 'vitest'

export const mapApi = {
  fitBounds: vi.fn(),
  setView: vi.fn(),
  getZoom: vi.fn(() => 12),
  getBounds: vi.fn(() => ({ contains: vi.fn(() => true) })),
  attributionControl: undefined,
}

/** The handlers the component under test registered with useMapEvents (e.g. { click }). */
export const mapEvents: { handlers: Record<string, (event: unknown) => void> } = { handlers: {} }

export function clickMap(lat: number, lng: number) {
  mapEvents.handlers.click?.({ latlng: { lat, lng } })
}

interface MarkerProps {
  position: [number, number]
  icon?: { options?: { html?: string } }
  title?: string
  children?: ReactNode
}

export const reactLeafletMock = {
  MapContainer: ({ children }: { children?: ReactNode }) => <div data-testid="map-container">{children}</div>,
  Marker: ({ position, icon, title, children }: MarkerProps) => (
    <div
      data-testid="marker"
      data-lat={position[0]}
      data-lng={position[1]}
      data-title={title}
      data-icon-html={icon?.options?.html}
    >
      {children}
    </div>
  ),
  Popup: ({ children }: { children?: ReactNode }) => <div data-testid="popup">{children}</div>,
  useMap: () => mapApi,
  useMapEvents: (handlers: Record<string, (event: unknown) => void>) => {
    mapEvents.handlers = handlers
    return mapApi
  },
}

export const clusterMock = {
  default: ({ children }: { children?: ReactNode }) => <div data-testid="cluster-group">{children}</div>,
}

export function resetLeafletMock() {
  mapApi.fitBounds.mockClear()
  mapApi.setView.mockClear()
  mapApi.getBounds.mockClear()
  mapEvents.handlers = {}
}
