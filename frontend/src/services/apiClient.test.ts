import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { server } from '@/test/server'
import { url } from '@/test/utils'

import { api, getApiErrorMessage, getFieldErrors } from './apiClient'
import { configureAuth, getRefreshToken, setRefreshToken } from './authBridge'

let access: string | null
const onTokensRefreshed = vi.fn()
const onAuthFailure = vi.fn()

beforeEach(() => {
  access = 'access-1'
  onTokensRefreshed.mockReset()
  onAuthFailure.mockReset()
  setRefreshToken('refresh-1')
  configureAuth({
    getAccessToken: () => access,
    onTokensRefreshed: (tokens) => {
      access = tokens.access
      onTokensRefreshed(tokens)
    },
    onAuthFailure,
  })
})

afterEach(() => configureAuth(null))

/** A protected endpoint that only accepts `valid` as the bearer token. */
function protectedEndpoint(valid: string, hits: string[] = []) {
  return http.get(url('/things/'), ({ request }) => {
    const auth = request.headers.get('authorization')
    hits.push(auth ?? 'none')
    return auth === `Bearer ${valid}` ? HttpResponse.json({ ok: true }) : HttpResponse.json({ detail: 'expired' }, { status: 401 })
  })
}

describe('request interceptor', () => {
  it('attaches the in-memory access token as a bearer header', async () => {
    const hits: string[] = []
    server.use(protectedEndpoint('access-1', hits))
    await expect(api.get('/things/')).resolves.toMatchObject({ data: { ok: true } })
    expect(hits).toEqual(['Bearer access-1'])
  })

  it('sends no Authorization header when there is no token', async () => {
    access = null
    const hits: string[] = []
    server.use(protectedEndpoint('access-1', hits))
    await expect(api.get('/things/')).rejects.toBeTruthy() // 401, and nothing to refresh with... see below
    expect(hits[0]).toBe('none')
  })
})

describe('401 -> refresh -> retry', () => {
  it('refreshes once, stores the rotated pair, and retries the original request with the new token', async () => {
    const hits: string[] = []
    let refreshCalls = 0
    server.use(
      protectedEndpoint('access-2', hits),
      http.post(url('/auth/token/refresh/'), async ({ request }) => {
        refreshCalls++
        expect(await request.json()).toEqual({ refresh: 'refresh-1' })
        return HttpResponse.json({ access: 'access-2', refresh: 'refresh-2' })
      }),
    )

    const res = await api.get('/things/')

    expect(res.data).toEqual({ ok: true })
    expect(hits).toEqual(['Bearer access-1', 'Bearer access-2']) // first try, then the retry with the new token
    expect(refreshCalls).toBe(1)
    expect(onTokensRefreshed).toHaveBeenCalledWith({ access: 'access-2', refresh: 'refresh-2' })
    expect(getRefreshToken()).toBe('refresh-2') // rotation: the old one is now blacklisted server-side
    expect(onAuthFailure).not.toHaveBeenCalled()
  })

  it('makes ONE refresh call when several requests fail at once (rotation would break a second one)', async () => {
    let refreshCalls = 0
    server.use(
      protectedEndpoint('access-2'),
      http.post(url('/auth/token/refresh/'), async () => {
        refreshCalls++
        await new Promise((r) => setTimeout(r, 30)) // keep the refresh in flight while the others 401
        return HttpResponse.json({ access: 'access-2', refresh: 'refresh-2' })
      }),
    )

    const results = await Promise.all([api.get('/things/'), api.get('/things/'), api.get('/things/')])

    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect(refreshCalls).toBe(1)
  })

  it('logs out (onAuthFailure) and rejects when the refresh itself fails', async () => {
    let refreshCalls = 0
    const hits: string[] = []
    server.use(
      protectedEndpoint('never-valid', hits),
      http.post(url('/auth/token/refresh/'), () => {
        refreshCalls++
        return HttpResponse.json({ detail: 'Token is blacklisted' }, { status: 401 })
      }),
    )

    await expect(api.get('/things/')).rejects.toMatchObject({ response: { status: 401 } })

    expect(onAuthFailure).toHaveBeenCalledTimes(1)
    expect(getRefreshToken()).toBeNull() // stale token discarded
    expect(refreshCalls).toBe(1) // no retry storm
    expect(hits).toHaveLength(1) // the original request was not retried
  })

  it('logs out when there is no refresh token at all', async () => {
    setRefreshToken(null)
    server.use(protectedEndpoint('never-valid'))
    await expect(api.get('/things/')).rejects.toMatchObject({ response: { status: 401 } })
    expect(onAuthFailure).toHaveBeenCalledTimes(1)
  })

  it('retries only once: a 401 even with the fresh token does not loop', async () => {
    let refreshCalls = 0
    const hits: string[] = []
    server.use(
      protectedEndpoint('some-other-token', hits),
      http.post(url('/auth/token/refresh/'), () => {
        refreshCalls++
        return HttpResponse.json({ access: 'access-2', refresh: 'refresh-2' })
      }),
    )

    await expect(api.get('/things/')).rejects.toMatchObject({ response: { status: 401 } })

    expect(hits).toHaveLength(2) // original + exactly one retry
    expect(refreshCalls).toBe(1)
  })

  it('keeps the old refresh token if the backend does not rotate', async () => {
    server.use(
      protectedEndpoint('access-2'),
      http.post(url('/auth/token/refresh/'), () => HttpResponse.json({ access: 'access-2' })),
    )
    await api.get('/things/')
    expect(getRefreshToken()).toBe('refresh-1')
  })

  it.each(['/auth/login/', '/auth/register/'])('does not try to refresh on a 401 from %s (bad credentials)', async (path) => {
    let refreshCalls = 0
    server.use(
      http.post(url(path), () => HttpResponse.json({ detail: 'No active account' }, { status: 401 })),
      http.post(url('/auth/token/refresh/'), () => {
        refreshCalls++
        return HttpResponse.json({ access: 'x', refresh: 'y' })
      }),
    )
    await expect(api.post(path, {})).rejects.toMatchObject({ response: { status: 401 } })
    expect(refreshCalls).toBe(0)
    expect(onAuthFailure).not.toHaveBeenCalled()
  })

  it('passes non-401 errors straight through without touching auth', async () => {
    server.use(http.get(url('/things/'), () => HttpResponse.json({ detail: 'nope' }, { status: 403 })))
    await expect(api.get('/things/')).rejects.toMatchObject({ response: { status: 403 } })
    expect(onAuthFailure).not.toHaveBeenCalled()
  })
})

describe('error helpers', () => {
  async function failWith(status: number, body: unknown) {
    server.use(http.get(url('/x/'), () => HttpResponse.json(body as object, { status })))
    return api.get('/x/').catch((e) => e)
  }

  it('prefers the DRF detail message', async () => {
    expect(getApiErrorMessage(await failWith(403, { detail: 'You do not have permission.' }))).toBe('You do not have permission.')
  })

  it('falls back to the first field error', async () => {
    expect(getApiErrorMessage(await failWith(400, { title: ['Too short.'] }))).toBe('Too short.')
  })

  it('has a friendly message for throttling', async () => {
    expect(getApiErrorMessage(await failWith(429, { detail: 'Request was throttled.' }))).toMatch(/too many requests/i)
  })

  it('reports an unreachable server', async () => {
    server.use(http.get(url('/x/'), () => HttpResponse.error()))
    const error = await api.get('/x/').catch((e) => e)
    expect(getApiErrorMessage(error)).toMatch(/cannot reach the server/i)
  })

  it('getFieldErrors flattens DRF 400s and ignores everything else', async () => {
    expect(getFieldErrors(await failWith(400, { email: ['Taken.'], password: ['Too common.', 'Too short.'] }))).toEqual({
      email: 'Taken.',
      password: 'Too common.',
    })
    expect(getFieldErrors(await failWith(500, { email: ['x'] }))).toEqual({})
    expect(getFieldErrors(new Error('x'))).toEqual({})
  })
})
