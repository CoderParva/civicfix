import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { cloneElement, createElement, type ReactElement } from 'react'
import { toast } from 'sonner'
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

// jsdom has no layout, so Recharts' ResponsiveContainer measures 0x0 and draws nothing. Give charts a
// fixed size so the real SVG renders and the tests can look at it.
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    createElement('div', { style: { width: 600, height: 300 } }, cloneElement(children, { width: 600, height: 300 })),
}))

// Routes are lazy-loaded, so the first test to visit one pays for a cold import (Recharts is heavy) while other
// test files run in parallel: that can exceed the 1 s default. A passing query returns at once; only a real
// failure waits the full time.
configure({ asyncUtilTimeout: 5000 })

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  cleanup()
  toast.dismiss() // sonner's store is module-global: a toast from one test must not leak into the next
  // Recharts measures label text in a <span> it appends straight to <body>, outside the tree RTL cleans up.
  // Left behind, it holds a chart label (e.g. a department name) and satisfies the next test's text queries.
  document.getElementById('recharts_measurement_span')?.remove()
  server.resetHandlers()
  sessionStorage.clear()
})
afterAll(() => server.close())

// jsdom has no object URLs (used for photo previews).
let counter = 0
URL.createObjectURL = vi.fn(() => `blob:test/${counter++}`)
URL.revokeObjectURL = vi.fn()
// jsdom does not implement scrolling (ScrollRestoration calls it on every navigation).
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
