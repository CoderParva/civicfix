import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { fakeJwt, makeUser } from '@/test/factories'
import { server } from '@/test/server'
import { issuesListHandler, renderApp, url } from '@/test/utils'

import { loginSchema, registerSchema } from './schemas'

const GOOD = { full_name: 'Asha Verma', email: 'asha@example.com', password: 'Str0ng-Passw0rd!x', confirmPassword: 'Str0ng-Passw0rd!x' }

describe('schemas', () => {
  it('login: requires a valid email and a password', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: '' }).success).toBe(false)
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true)
  })

  it.each([
    ['short password', { password: 'abc123', confirmPassword: 'abc123' }],
    ['numeric-only password', { password: '1234567890', confirmPassword: '1234567890' }],
    ['mismatched confirmation', { confirmPassword: 'different-One1!' }],
    ['bad email', { email: 'asha@' }],
    ['one-letter name', { full_name: 'A' }],
  ])('register: rejects %s', (_label, override) => {
    expect(registerSchema.safeParse({ ...GOOD, ...override }).success).toBe(false)
  })

  it('register: accepts good values', () => {
    expect(registerSchema.safeParse(GOOD).success).toBe(true)
  })
})

describe('Login form', () => {
  it('shows required-field errors and does not call the API when submitted empty', async () => {
    let calls = 0
    server.use(http.post(url('/auth/login/'), () => (calls++, HttpResponse.json({}))))
    renderApp('/login')
    await userEvent.click(await screen.findByRole('button', { name: /log in/i }))

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(calls).toBe(0)
  })

  it('rejects a malformed email client-side', async () => {
    renderApp('/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'not-an-email')
    await userEvent.type(screen.getByLabelText('Password'), 'whatever')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
  })

  it('shows the server error for wrong credentials and stays on the page', async () => {
    server.use(
      http.post(url('/auth/login/'), () =>
        HttpResponse.json({ detail: 'No active account found with the given credentials' }, { status: 401 }),
      ),
    )
    renderApp('/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'asha@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByText('No active account found with the given credentials')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('logs a citizen in and lands on the dashboard, with the user shown in the navbar', async () => {
    const user = makeUser()
    let body: unknown
    server.use(
      http.post(url('/auth/login/'), async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ access: fakeJwt({ role: 'citizen' }), refresh: 'refresh-token', user })
      }),
      issuesListHandler([]),
    )
    renderApp('/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'asha@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ng-Passw0rd!x')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByRole('heading', { name: /hello, asha verma/i })).toBeInTheDocument()
    expect(body).toEqual({ email: 'asha@example.com', password: 'Str0ng-Passw0rd!x' })
    expect(screen.getByTestId('nav-user')).toHaveTextContent('Asha Verma')
    expect(sessionStorage.getItem('civicfix.refresh')).toBe('refresh-token') // survives a reload
  })
})

describe('Register form', () => {
  async function fill(values: Partial<typeof GOOD>) {
    const v = { ...GOOD, ...values }
    await userEvent.type(await screen.findByLabelText('Full name'), v.full_name)
    await userEvent.type(screen.getByLabelText('Email'), v.email)
    await userEvent.type(screen.getByLabelText('Password'), v.password)
    await userEvent.type(screen.getByLabelText('Confirm password'), v.confirmPassword)
  }

  it('shows validation errors for an empty form and sends nothing', async () => {
    let calls = 0
    server.use(http.post(url('/auth/register/'), () => (calls++, HttpResponse.json({}, { status: 201 }))))
    renderApp('/register')
    await userEvent.click(await screen.findByRole('button', { name: /create account/i }))

    expect(await screen.findByText('Enter your full name')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(calls).toBe(0)
  })

  it('flags a password confirmation mismatch', async () => {
    renderApp('/register')
    await fill({ confirmPassword: 'Different-Passw0rd!' })
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
  })

  it('maps server errors (duplicate email, weak password) onto the right fields', async () => {
    server.use(
      http.post(url('/auth/register/'), () =>
        HttpResponse.json(
          { email: ['A user with this email already exists.'], password: ['This password is too common.'] },
          { status: 400 },
        ),
      ),
    )
    renderApp('/register')
    await fill({})
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('A user with this email already exists.')).toBeInTheDocument()
    expect(screen.getByText('This password is too common.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('registers, signs in with the same credentials, and lands on the dashboard', async () => {
    const order: string[] = []
    let registerBody: Record<string, unknown> = {}
    server.use(
      http.post(url('/auth/register/'), async ({ request }) => {
        order.push('register')
        registerBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(makeUser(), { status: 201 })
      }),
      http.post(url('/auth/login/'), () => {
        order.push('login')
        return HttpResponse.json({ access: fakeJwt({ role: 'citizen' }), refresh: 'r', user: makeUser() })
      }),
      issuesListHandler([]),
    )
    renderApp('/register')
    await fill({})
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByRole('heading', { name: /hello, asha verma/i })).toBeInTheDocument()
    expect(order).toEqual(['register', 'login'])
    // role is never something the client sends, and the confirm field stays client-side
    expect(registerBody).toEqual({ email: 'asha@example.com', full_name: 'Asha Verma', password: 'Str0ng-Passw0rd!x' })
  })

  it('tells the user when the account was created but auto sign-in failed', async () => {
    server.use(
      http.post(url('/auth/register/'), () => HttpResponse.json(makeUser(), { status: 201 })),
      http.post(url('/auth/login/'), () => HttpResponse.json({ detail: 'boom' }, { status: 500 })),
    )
    renderApp('/register')
    await fill({})
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(screen.getByText(/account was created, but signing in failed/i)).toBeInTheDocument())
  })
})
