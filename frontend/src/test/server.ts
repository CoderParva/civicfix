import { setupServer } from 'msw/node'

/** Shared msw server: tests add per-test handlers with server.use(...). Unhandled requests fail loudly. */
export const server = setupServer()
