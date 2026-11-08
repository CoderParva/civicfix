import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Inbox } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { HBarChart, StackedBarChart } from '@/components/charts/BarCharts'
import { DonutChart } from '@/components/charts/DonutChart'
import { TrendChart } from '@/components/charts/TrendChart'

import { DataTable, parseOrdering, toOrdering, type Column, type SortState } from './DataTable'
import { SegmentedControl } from './SegmentedControl'
import { StatTile } from './StatTile'

interface Row {
  id: string
  name: string
  count: number
}
const rows: Row[] = [
  { id: 'a', name: 'Alpha', count: 3 },
  { id: 'b', name: 'Bravo', count: 1 },
]
const columns: Column<Row>[] = [
  { id: 'name', header: 'Name', sortKey: 'title', cell: (r) => r.name },
  { id: 'count', header: 'Count', sortKey: 'votes', align: 'right', cell: (r) => r.count },
  { id: 'extra', header: 'Extra', hideBelow: 'lg', cell: () => 'x' },
  { id: 'static', header: 'Static', cell: () => 's' },
]

function table(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(<DataTable label="People" columns={columns} rows={rows} rowKey={(r) => r.id} {...props} />)
}

describe('ordering <-> sort state', () => {
  const fallback: SortState = { key: 'created_at', direction: 'desc' }
  it('parses the backend format', () => {
    expect(parseOrdering('priority', fallback)).toEqual({ key: 'priority', direction: 'asc' })
    expect(parseOrdering('-priority', fallback)).toEqual({ key: 'priority', direction: 'desc' })
    expect(parseOrdering(null, fallback)).toBe(fallback)
    expect(parseOrdering('', fallback)).toBe(fallback)
  })
  it('round-trips', () => {
    for (const value of ['title', '-title', '-votes']) expect(toOrdering(parseOrdering(value, fallback))).toBe(value)
  })
})

describe('DataTable', () => {
  it('renders an accessible table with a header cell per column and a row per item', () => {
    table()
    const t = screen.getByRole('table', { name: 'People' })
    expect(within(t).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Count', 'Extra', 'Static'])
    expect(within(t).getAllByRole('row')).toHaveLength(3) // header + 2
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('only sortable columns get a sort button, and only when a handler is given', () => {
    const { unmount } = table()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    unmount()
    table({ sort: { key: 'title', direction: 'asc' }, onSortChange: () => {} })
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Name', 'Count'])
  })

  it('exposes the active sort with aria-sort', () => {
    table({ sort: { key: 'votes', direction: 'desc' }, onSortChange: () => {} })
    expect(screen.getByRole('columnheader', { name: 'Count' })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByRole('columnheader', { name: 'Static' })).not.toHaveAttribute('aria-sort')
  })

  it('clicking the active column reverses it; clicking another starts with a sensible direction', async () => {
    const onSortChange = vi.fn()
    table({ sort: { key: 'votes', direction: 'desc' }, onSortChange })
    await userEvent.click(screen.getByRole('button', { name: 'Count' }))
    await userEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(onSortChange.mock.calls).toEqual([
      [{ key: 'votes', direction: 'asc' }],
      [{ key: 'title', direction: 'asc' }], // text columns start A-Z
    ])
  })

  it('numeric / date columns start with the biggest first', async () => {
    const onSortChange = vi.fn()
    table({ sort: { key: 'title', direction: 'asc' }, onSortChange })
    await userEvent.click(screen.getByRole('button', { name: 'Count' }))
    expect(onSortChange).toHaveBeenCalledWith({ key: 'votes', direction: 'desc' })
  })

  it('shows skeleton rows (hidden from assistive tech) while loading, and no real rows', () => {
    table({ loading: true })
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    expect(document.querySelectorAll('tbody tr[aria-hidden]')).toHaveLength(6)
  })

  it('shows the empty state below the header when there are no rows', () => {
    table({ rows: [], empty: <p>Nothing here</p> })
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('does not show the empty state while loading', () => {
    table({ rows: [], loading: true, empty: <p>Nothing here</p> })
    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument()
  })

  it('click-through rows call onRowClick; the pointer cursor only appears when clickable', async () => {
    const onRowClick = vi.fn()
    table({ onRowClick })
    await userEvent.click(screen.getByText('Bravo'))
    expect(onRowClick).toHaveBeenCalledWith(rows[1])
    expect(screen.getByText('Bravo').closest('tr')).toHaveClass('cursor-pointer')
  })

  it('a button inside a row can stop the row click', async () => {
    const onRowClick = vi.fn()
    const inner = vi.fn()
    table({ onRowClick, columns: [{ id: 'x', header: 'X', cell: () => <button onClick={(e) => (e.stopPropagation(), inner())}>go</button> }] })
    await userEvent.click(screen.getAllByRole('button', { name: 'go' })[0])
    expect(inner).toHaveBeenCalledTimes(1)
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('dims the rows while refreshing but keeps them on screen', () => {
    table({ refreshing: true })
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(document.querySelector('tbody')).toHaveClass('opacity-60')
  })

  it('right-aligns numeric columns and hides low-priority columns on small screens (via classes)', () => {
    table()
    expect(screen.getByRole('columnheader', { name: 'Count' })).toHaveClass('text-right')
    expect(screen.getByRole('columnheader', { name: 'Extra' })).toHaveClass('hidden', 'lg:table-cell')
  })

  it('renders a footer', () => {
    table({ footer: <span>Showing 1-2 of 2</span> })
    expect(screen.getByText('Showing 1-2 of 2')).toBeInTheDocument()
  })

  it('a table with no sort state at all does not crash (the Departments table)', () => {
    expect(() => table({ columns: [{ id: 'name', header: 'Name', cell: (r) => r.name }] })).not.toThrow()
  })
})

describe('SegmentedControl', () => {
  const options = [
    { value: '', label: 'All' },
    { value: 'a', label: 'Alpha', count: 4 },
  ]
  it('marks the selected option and reports changes', async () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Filter" value="" options={options} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Alpha/ })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    expect(onChange).toHaveBeenCalledWith('a')
    expect(screen.getByRole('group', { name: 'Filter' })).toBeInTheDocument()
  })
  it('shows counts when given', () => {
    render(<SegmentedControl label="Filter" value="" options={options} onChange={() => {}} />)
    expect(screen.getByText('4')).toBeInTheDocument()
  })
})

describe('StatTile', () => {
  it('shows label, value and hint, with the value readable as one phrase', () => {
    render(<StatTile label="Resolved" value={85} icon={Inbox} hint="Fixed, with proof" />)
    expect(screen.getByLabelText('Resolved: 85')).toHaveTextContent('85')
    expect(screen.getByText('Fixed, with proof')).toBeInTheDocument()
  })
  it('shows skeletons instead of a number while loading', () => {
    render(<StatTile label="Resolved" value={0} icon={Inbox} loading />)
    expect(screen.queryByLabelText('Resolved: 0')).not.toBeInTheDocument()
  })
})

describe('charts (real Recharts SVG, with the data also available as a table)', () => {
  it('TrendChart draws an SVG and exposes every point as a table row', () => {
    const data = [
      { date: '2026-10-05', reported: 4, resolved: 1 },
      { date: '2026-10-12', reported: 7, resolved: 5 },
    ]
    const { container } = render(<TrendChart data={data} unit="week" />)
    expect(container.querySelector('svg.recharts-surface')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: /reported and resolved per week/i })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getByText('2026-10-12').closest('tr')).toHaveTextContent('75')
    expect(screen.getByLabelText('Legend')).toHaveTextContent('Reported')
  })

  it('DonutChart shows the total in the middle and a legend with value and share', () => {
    render(
      <DonutChart
        centerLabel="Issues"
        caption="By status"
        slices={[
          { key: 'a', label: 'Resolved', value: 3, color: 'green' },
          { key: 'b', label: 'Open', value: 1, color: 'blue' },
          { key: 'c', label: 'Empty', value: 0, color: 'grey' },
        ]}
      />,
    )
    expect(screen.getByText('4')).toBeInTheDocument()
    const legend = screen.getByRole('list', { name: 'Breakdown' })
    expect(within(legend).getByText('Resolved').closest('li')).toHaveTextContent('75%')
    expect(within(legend).getByText('Empty').closest('li')).toHaveTextContent('0%')
    expect(screen.getByRole('table', { name: 'By status' })).toBeInTheDocument()
  })

  it('DonutChart with no data at all still renders (a neutral ring), without dividing by zero', () => {
    const { container } = render(<DonutChart centerLabel="Issues" caption="Empty" slices={[{ key: 'a', label: 'None', value: 0, color: 'grey' }]} />)
    expect(container.querySelector('svg.recharts-surface')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.queryByText('NaN%')).not.toBeInTheDocument()
  })

  it('HBarChart and StackedBarChart expose their numbers too', () => {
    const { container } = render(
      <>
        <HBarChart caption="By priority" rows={[{ label: 'High', value: 5, color: 'red' }, { label: 'Low', value: 2, color: 'grey' }]} />
        <StackedBarChart
          caption="By department"
          series={[{ key: 'done', label: 'Done', color: 'green' }, { key: 'todo', label: 'To do', color: 'blue' }]}
          rows={[{ label: 'Roads', values: { done: 3, todo: 4 } }]}
        />
      </>,
    )
    expect(container.querySelectorAll('svg.recharts-surface').length).toBe(2)
    expect(within(screen.getByRole('table', { name: 'By priority' })).getByText('High').closest('tr')).toHaveTextContent('5')
    expect(within(screen.getByRole('table', { name: 'By department' })).getByText('Roads').closest('tr')).toHaveTextContent('34')
  })
})
