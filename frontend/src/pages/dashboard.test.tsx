import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { makeIssue } from '@/test/factories'
import { server } from '@/test/server'
import { issuesListHandler, renderApp, signInAs, url } from '@/test/utils'
import type { IssueStatus } from '@/types/api'

const issuesWith = (...statuses: IssueStatus[]) => statuses.map((status) => makeIssue({ status }))
const stat = (key: string) => within(screen.getByTestId(`stat-${key}`)).getByText(/^\d+$/)

describe('Citizen dashboard', () => {
  it('tallies the statuses of the fetched issues, with no hardcoded numbers', async () => {
    signInAs('citizen')
    server.use(
      issuesListHandler(
        issuesWith('reported', 'under_review', 'assigned', 'in_progress', 'in_progress', 'resolved', 'resolved', 'resolved', 'rejected'),
      ),
    )
    renderApp('/dashboard')

    await screen.findByLabelText('Report statistics')
    expect(stat('total')).toHaveTextContent('9')
    expect(stat('pending')).toHaveTextContent('3')
    expect(stat('inProgress')).toHaveTextContent('2')
    expect(stat('resolved')).toHaveTextContent('3')
    expect(screen.getByText(/1 of your reports was not accepted/i)).toBeInTheDocument()
  })

  it('walks every page of /issues/?mine=true, so the tally covers more than the first 20', async () => {
    signInAs('citizen')
    const all = [...issuesWith(...Array(5).fill('resolved')), ...issuesWith(...Array(4).fill('reported')), ...issuesWith('in_progress')]
    const requested: string[] = []
    server.use(
      issuesListHandler(all, 3, (params) => requested.push(`mine=${params.get('mine')}&page=${params.get('page')}`)), // 10 issues / 3 per page = 4 pages
    )
    renderApp('/dashboard')

    await screen.findByLabelText('Report statistics')
    expect(stat('total')).toHaveTextContent('10')
    expect(stat('resolved')).toHaveTextContent('5')
    expect(stat('pending')).toHaveTextContent('4')
    expect(stat('inProgress')).toHaveTextContent('1')
    expect(requested).toEqual(['mine=true&page=1', 'mine=true&page=2', 'mine=true&page=3', 'mine=true&page=4'])
  })

  it('asks the backend for only the user’s own issues', async () => {
    signInAs('citizen')
    const seen: string[] = []
    server.use(
      http.get(url('/issues/'), ({ request }) => {
        seen.push(new URL(request.url).search)
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
      }),
    )
    renderApp('/dashboard')
    await screen.findByLabelText('Report statistics')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('mine=true')
  })

  it('shows zeros and a call to action when the citizen has no reports', async () => {
    signInAs('citizen')
    server.use(issuesListHandler([]))
    renderApp('/dashboard')

    await screen.findByLabelText('Report statistics')
    for (const key of ['total', 'pending', 'inProgress', 'resolved']) expect(stat(key)).toHaveTextContent('0')
    expect(screen.getByText(/you have not reported anything yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /report your first issue/i })).toHaveAttribute('href', '/report')
  })

  it('lists the three most recent reports with status badges', async () => {
    signInAs('citizen')
    server.use(
      issuesListHandler([
        makeIssue({ title: 'Newest', status: 'resolved' }),
        makeIssue({ title: 'Second', status: 'in_progress' }),
        makeIssue({ title: 'Third', status: 'reported' }),
        makeIssue({ title: 'Oldest hidden from recent' }),
      ]),
    )
    renderApp('/dashboard')
    const cards = await screen.findAllByTestId('issue-card')
    expect(cards).toHaveLength(3)
    expect(within(cards[0]).getByText('Resolved')).toBeInTheDocument()
    expect(within(cards[1]).getByText('In progress')).toBeInTheDocument()
    expect(screen.queryByText('Oldest hidden from recent')).not.toBeInTheDocument()
  })

  it('shows a loading skeleton first, then an error with retry that recovers', async () => {
    signInAs('citizen')
    let attempts = 0
    server.use(
      http.get(url('/issues/'), () => {
        attempts++
        return attempts === 1
          ? HttpResponse.json({ detail: 'Server exploded' }, { status: 500 })
          : HttpResponse.json({ count: 1, next: null, previous: null, results: issuesWith('resolved') })
      }),
    )
    renderApp('/dashboard')

    expect(await screen.findByText('Server exploded')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    await screen.findByLabelText('Report statistics')
    expect(stat('resolved')).toHaveTextContent('1')
  })
})
