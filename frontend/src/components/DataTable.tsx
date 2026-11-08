import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/utils/cn'

export interface Column<T> {
  id: string
  header: string
  /** Backend sort key. Omit for columns that cannot be sorted. */
  sortKey?: string
  cell: (row: T) => ReactNode
  align?: 'left' | 'right'
  /** Hide this column below a breakpoint so the table degrades gracefully on narrow screens. */
  hideBelow?: 'md' | 'lg' | 'xl'
  className?: string
}

export interface SortState {
  key: string
  direction: 'asc' | 'desc'
}

/** "-priority" <-> { key: 'priority', direction: 'desc' } (the backend's `ordering` format). */
export function parseOrdering(value: string | null | undefined, fallback: SortState): SortState {
  if (!value) return fallback
  return value.startsWith('-') ? { key: value.slice(1), direction: 'desc' } : { key: value, direction: 'asc' }
}
export const toOrdering = (sort: SortState) => (sort.direction === 'desc' ? `-${sort.key}` : sort.key)

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Accessible name of the table. */
  label: string
  sort?: SortState
  onSortChange?: (next: SortState) => void
  loading?: boolean
  /** Shown instead of the body when there are no rows. */
  empty?: ReactNode
  onRowClick?: (row: T) => void
  footer?: ReactNode
  /** Dims the rows while a refetch is in flight (the previous data stays on screen). */
  refreshing?: boolean
}

const HIDE = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' } as const

/**
 * A data table that is nice to scan: quiet header, 56px rows, hover wash, click-through rows, real
 * sortable columns (aria-sort + a visible direction), skeleton rows while loading, and an empty
 * state. Sorting is the BACKEND's: the table only reports what the user asked for.
 */
export function DataTable<T>({ columns, rows, rowKey, label, sort, onSortChange, loading, empty, onRowClick, footer, refreshing }: DataTableProps<T>) {
  const toggle = (key: string) => {
    if (!onSortChange) return
    // first click: sensible direction for that column; second: reverse
    if (sort?.key === key) onSortChange({ key, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
    else onSortChange({ key, direction: key === 'title' ? 'asc' : 'desc' })
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-surface shadow-xs">
      <div className="overflow-x-auto">
        <table aria-label={label} aria-busy={loading || refreshing} className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="bg-subtle">
              {columns.map((column) => {
                const active = !!column.sortKey && sort?.key === column.sortKey
                const ariaSort = !column.sortKey ? undefined : active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                const Icon = !active ? ChevronsUpDown : sort!.direction === 'asc' ? ArrowUp : ArrowDown
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn('type-overline h-10 border-b px-4 first:pl-6 last:pr-6', column.align === 'right' && 'text-right', column.hideBelow && HIDE[column.hideBelow])}
                  >
                    {column.sortKey && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggle(column.sortKey!)}
                        className={cn(
                          '-mx-2 inline-flex items-center gap-1 rounded-md px-2 py-1 uppercase transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                          active && 'text-foreground',
                        )}
                      >
                        {column.header}
                        <Icon aria-hidden className={cn('size-3.5', !active && 'opacity-40')} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className={cn('transition-opacity duration-150', refreshing && 'opacity-60')}>
            {loading
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} aria-hidden>
                    {columns.map((column) => (
                      <td key={column.id} className={cn('h-14 border-b px-4 first:pl-6 last:pr-6', column.hideBelow && HIDE[column.hideBelow])}>
                        <Skeleton className={cn('h-4', column.id === columns[0].id ? 'w-3/4' : 'w-16')} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn('group transition-colors duration-150 hover:bg-subtle', onRowClick && 'cursor-pointer')}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          'type-body h-14 border-b px-4 align-middle group-last:border-b-0 first:pl-6 last:pr-6',
                          column.align === 'right' && 'text-right tabular',
                          column.hideBelow && HIDE[column.hideBelow],
                          column.className,
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && empty}
      {footer && <div className="border-t bg-subtle px-6 py-3">{footer}</div>}
    </div>
  )
}
