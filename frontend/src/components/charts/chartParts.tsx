import type { ReactNode } from 'react'

import { Panel, PanelHeader } from '@/components/ui/panel'

/** Shared look for every chart: quiet axes, hairline grid, tokens for colour. */
export const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 } as const
export const GRID_STROKE = 'var(--border)'

export interface TooltipRow {
  label: string
  value: ReactNode
  color?: string
}

/** The one tooltip every chart uses: a small elevated surface. */
export function TooltipCard({ title, rows }: { title?: ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="type-body min-w-36 rounded-xl border bg-surface p-4 shadow-md">
      {title && <p className="type-caption mb-2 font-medium text-foreground">{title}</p>}
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-muted-foreground">
              {row.color && <span aria-hidden className="size-2 rounded-full" style={{ background: row.color }} />}
              {row.label}
            </span>
            <span className="tabular font-medium text-foreground">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Charts are pictures; this is the same data as a table for screen readers (and for tests). It is
 * visually hidden but always in the DOM.
 */
export function ChartDataTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="type-caption flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

interface ChartCardProps {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
}

export function ChartCard({ title, description, actions, children, className, testId }: ChartCardProps) {
  return (
    <Panel className={`flex flex-col ${className ?? ''}`} data-testid={testId} aria-label={title}>
      <PanelHeader title={title} description={description} actions={actions} />
      <div className="flex flex-1 flex-col justify-center px-6 pt-4 pb-6">{children}</div>
    </Panel>
  )
}
