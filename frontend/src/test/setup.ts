import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'

import { server } from './server'

// MapLibre needs WebGL, which jsdom does not have: stub the bridge and report "no WebGL" so the
// map falls back to markers on a blank background. Real tile loading is covered by the browser E2E.
vi.mock('@maplibre/maplibre-gl-leaflet', () => ({
  maplibreGL: vi.fn(() => ({ addTo() {}, remove() {} })),
}))
vi.mock('@/features/map/maplibreWorker', () => ({}))
vi.mock('@/features/map/tiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/map/tiles')>()),
  webglAvailable: vi.fn(() => false),
}))

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  sessionStorage.clear()
})
afterAll(() => server.close())

// jsdom has no object URLs (used for photo previews).
let counter = 0
URL.createObjectURL = vi.fn(() => `blob:test/${counter++}`)
URL.revokeObjectURL = vi.fn()
