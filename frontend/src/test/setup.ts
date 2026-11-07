import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'

import { server } from './server'

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
