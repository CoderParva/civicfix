import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'

import { AuthProvider } from '@/context/AuthContext'
import { appRoutes } from '@/routes'
import { API_URL } from '@/services/apiClient'
import { setRefreshToken } from '@/services/authBridge'
import type { Issue, Role, User } from '@/types/api'

import { fakeJwt, makeUser } from './factories'
import { server } from './server'

export const url = (path: string) => `${API_URL}${path}`

export function newTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
}

/** Render the real route tree (real AuthProvider, real axios client) at `route`. */
export function renderApp(route = '/') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [route] })
  const queryClient = newTestQueryClient()
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { ...utils, router, queryClient }
}

/**
 * Make the app boot as an already signed-in user: a refresh token is in sessionStorage and the
 * backend (msw) accepts it, as after a page reload.
 */
export function signInAs(role: Role = 'citizen', userOverrides: Partial<User> = {}) {
  const user = makeUser({ role, ...userOverrides })
  setRefreshToken('stored-refresh')
  server.use(
    http.post(url('/auth/token/refresh/'), () =>
      HttpResponse.json({ access: fakeJwt({ role }), refresh: 'rotated-refresh' }),
    ),
    http.get(url('/auth/profile/'), () => HttpResponse.json(user)),
  )
  return user
}

/** msw handler for GET /issues/ that serves `issues` split into pages of `pageSize` (like DRF). */
export function issuesListHandler(issues: Issue[], pageSize = 20, onRequest?: (params: URLSearchParams) => void) {
  return http.get(url('/issues/'), ({ request }) => {
    const params = new URL(request.url).searchParams
    onRequest?.(params)
    const page = Number(params.get('page') ?? '1')
    const slice = issues.slice((page - 1) * pageSize, page * pageSize)
    const hasNext = page * pageSize < issues.length
    return HttpResponse.json({
      count: issues.length,
      next: hasNext ? url(`/issues/?mine=true&page=${page + 1}`) : null,
      previous: page > 1 ? url(`/issues/?mine=true&page=${page - 1}`) : null,
      results: slice,
    })
  })
}

/**
 * msw handler for the PUBLIC list: filters by category/status/priority and paginates the way the
 * Django view does (PAGE_SIZE 20, 404 for a page past the end). `onRequest` sees every call.
 */
export function publicIssuesHandler(
  issues: Issue[],
  onRequest?: (request: { params: URLSearchParams; authorization: string | null }) => void,
) {
  return http.get(url('/issues/'), ({ request }) => {
    const params = new URL(request.url).searchParams
    onRequest?.({ params, authorization: request.headers.get('authorization') })
    let rows = issues
    const category = params.get('category')
    const status = params.get('status')
    const priority = params.get('priority')
    if (category) rows = rows.filter((i) => String(i.category.id) === category)
    if (status) rows = rows.filter((i) => i.status === status)
    if (priority) rows = rows.filter((i) => i.priority === priority)
    const page = Number(params.get('page') ?? '1')
    const size = 20
    if (page < 1 || (page - 1) * size >= Math.max(rows.length, 1)) {
      return HttpResponse.json({ detail: 'Invalid page.' }, { status: 404 })
    }
    const next = page * size < rows.length ? url(`/issues/?page=${page + 1}`) : null
    return HttpResponse.json({
      count: rows.length,
      next,
      previous: page > 1 ? url(`/issues/?page=${page - 1}`) : null,
      results: rows.slice((page - 1) * size, page * size),
    })
  })
}
