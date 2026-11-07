import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { IssueCard, locationLabel } from '@/features/issues/components/IssueCard'
import { makeIssue } from '@/test/factories'

import { Pagination } from './Pagination'

describe('Pagination', () => {
  it('renders nothing for a single page', () => {
    const { container } = render(<Pagination page={1} pageCount={1} onPageChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the position and moves between pages', async () => {
    const onPageChange = vi.fn()
    render(<Pagination page={2} pageCount={3} onPageChange={onPageChange} />)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(onPageChange.mock.calls).toEqual([[3], [1]])
  })

  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(<Pagination page={1} pageCount={3} onPageChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    rerender(<Pagination page={3} pageCount={3} onPageChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})

describe('IssueCard (as used on Explore)', () => {
  const renderCard = (issue = makeIssue()) =>
    render(
      <MemoryRouter>
        <IssueCard issue={issue} />
      </MemoryRouter>,
    )

  it('shows image, title, category, location, date, status, priority and votes', () => {
    renderCard(
      makeIssue({
        title: 'Cracked road',
        status: 'in_progress',
        priority: 'high',
        vote_count: 7,
        address: 'MG Road, Indore',
        images: [{ id: 'i1', url: 'http://x/y.png', image_type: 'report', uploaded_at: '2026-11-01T00:00:00Z' }],
      }),
    )
    expect(screen.getByRole('link', { name: 'Cracked road' })).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('High priority')).toBeInTheDocument()
    expect(screen.getByText(/Pothole/)).toBeInTheDocument()
    expect(screen.getByText('MG Road, Indore')).toBeInTheDocument()
    expect(screen.getByLabelText('7 votes')).toHaveTextContent('▲ 7')
    expect(screen.getByText(/\d{4}/)).toBeInTheDocument() // the date
    expect(document.querySelector('img')).toHaveAttribute('src', 'http://x/y.png')
  })

  it('links the title to the issue detail page', () => {
    const issue = makeIssue({ id: 'abc-123' })
    renderCard(issue)
    expect(screen.getByRole('link', { name: issue.title })).toHaveAttribute('href', '/issues/abc-123')
  })

  it('uses the singular for one vote and falls back to coordinates without an address', () => {
    const issue = makeIssue({ vote_count: 1, address: '', location: { latitude: 22.7196, longitude: 75.8577 } })
    renderCard(issue)
    expect(screen.getByLabelText('1 vote')).toBeInTheDocument()
    expect(screen.getByText('22.7196, 75.8577')).toBeInTheDocument()
    expect(locationLabel(issue)).toBe('22.7196, 75.8577')
  })

  it('shows a placeholder when there is no photo', () => {
    renderCard(makeIssue({ images: [] }))
    expect(screen.getByText('No photo')).toBeInTheDocument()
  })
})
