import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { setRefreshToken } from '@/services/authBridge'
import { fakeJwt, makeIssue, makeUser } from '@/test/factories'
import { server } from '@/test/server'
import { adminListHandler, officerListHandler, staffDefaults } from '@/test/staff'
import { issuesListHandler, renderApp, signInAs, url } from '@/test/utils'

describe('ProtectedRoute (UX gate)', () => {
  it.each(['/dashboard', '/my-reports', '/report'])('sends a signed-out visitor from %s to /login', async (path) => {
    const { router } = renderApp(path)
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('remembers where the visitor was going and returns there after login', async () => {
    server.use(
      http.post(url('/auth/login/'), () =>
        HttpResponse.json({ access: fakeJwt({ role: 'citizen' }), refresh: 'r', user: makeUser() }),
      ),
      http.get(url('/categories/'), () => HttpResponse.json([])),
    )
    const { router } = renderApp('/report')
    await userEvent.type(await screen.findByLabelText('Email'), 'asha@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ng-Passw0rd!x')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByRole('form', { name: /report an issue/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/report')
  })

  it('shows a loading state, not the login page, while a stored session is being restored', async () => {
    signInAs('citizen')
    server.use(issuesListHandler([]))
    const { router } = renderApp('/dashboard')
    expect(screen.getByRole('status', { name: /loading session/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /hello, asha verma/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/dashboard')
  })

  it('restores the session from the refresh token and rotates it', async () => {
    signInAs('citizen')
    server.use(issuesListHandler([]))
    renderApp('/dashboard')
    await screen.findByRole('heading', { name: /hello, asha verma/i })
    expect(sessionStorage.getItem('civicfix.refresh')).toBe('rotated-refresh')
  })

  it('lets a signed-in citizen open the citizen pages', async () => {
    signInAs('citizen')
    server.use(issuesListHandler([makeIssue({ title: 'Broken swing' })]))
    renderApp('/my-reports')
    expect(await screen.findByText('Broken swing')).toBeInTheDocument()
  })

  it.each([
    ['officer', '/officer', 'Officer workspace'],
    ['admin', '/admin', 'Admin console'],
  ] as const)('keeps a %s out of the citizen pages (redirected to their own workspace at %s)', async (role, home, workspace) => {
    signInAs(role)
    server.use(...staffDefaults(), officerListHandler([]), adminListHandler([]))
    const { router } = renderApp('/dashboard')
    expect((await screen.findAllByText(workspace)).length).toBeGreaterThan(0) // shown in both the sidebar and the mobile header
    expect(router.state.location.pathname).toBe(home)
    expect(screen.queryByRole('heading', { name: /hello/i })).not.toBeInTheDocument()
  })

  it('does not trust a stale refresh token: an invalid one sends the visitor to /login', async () => {
    setRefreshToken('expired-or-blacklisted')
    server.use(
      http.post(url('/auth/token/refresh/'), () => HttpResponse.json({ detail: 'Token is blacklisted' }, { status: 401 })),
    )
    const { router } = renderApp('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(sessionStorage.getItem('civicfix.refresh')).toBeNull()
  })

  it('logs out when the session dies mid-use (refresh fails) and says so', async () => {
    signInAs('citizen') // page-load refresh succeeds ...
    let refreshCalls = 0
    server.use(
      http.post(url('/auth/token/refresh/'), () => {
        refreshCalls++
        // ... but the next one (triggered by a 401 on the dashboard's data request) is rejected
        return refreshCalls === 1
          ? HttpResponse.json({ access: fakeJwt({ role: 'citizen' }), refresh: 'rotated-refresh' })
          : HttpResponse.json({ detail: 'Token is blacklisted' }, { status: 401 })
      }),
      http.get(url('/issues/'), () => HttpResponse.json({ detail: 'Given token not valid' }, { status: 401 })),
    )
    const { router } = renderApp('/dashboard')

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.getByText(/your session expired/i)).toBeInTheDocument()
    expect(sessionStorage.getItem('civicfix.refresh')).toBeNull()
    expect(refreshCalls).toBe(2)
  })
})

describe('GuestOnly', () => {
  it('sends a signed-in citizen away from /login to the dashboard', async () => {
    signInAs('citizen')
    server.use(issuesListHandler([]))
    const { router } = renderApp('/login')
    expect(await screen.findByRole('heading', { name: /hello, asha verma/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/dashboard')
  })
})

describe('Logout', () => {
  it('clears the session and returns to the landing page', async () => {
    signInAs('citizen')
    server.use(issuesListHandler([]))
    const { router } = renderApp('/dashboard')
    await userEvent.click(await screen.findByRole('button', { name: /log out/i }))
    expect(await screen.findByRole('heading', { name: /fix your city/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(sessionStorage.getItem('civicfix.refresh')).toBeNull()
  })

  it('only skips the login wall once: opening a protected page afterwards goes to /login', async () => {
    signInAs('citizen')
    server.use(issuesListHandler([]))
    const { router } = renderApp('/dashboard')
    await userEvent.click(await screen.findByRole('button', { name: /log out/i }))
    await screen.findByRole('heading', { name: /fix your city/i })

    await act(() => router.navigate('/dashboard'))
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})
