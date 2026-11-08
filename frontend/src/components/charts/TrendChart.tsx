import { useId } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { AXIS_TICK, ChartDataTable, GRID_STROKE, Legend, TooltipCard } from './chartParts'

export interface TrendPoint {
  /** ISO date (the first day of the bucket). */
  date: string
  reported: number
  resolved: number
}

const SERIES = [
  { key: 'reported', label: 'Reported', color: 'var(--primary)' },
  { key: 'resolved', label: 'Resolved', color: 'var(--status-resolved)' },
] as const

const fmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** Reported vs resolved over time: two soft areas with a gradient fade, no chart junk. */
export function TrendChart({ data, height = 264, unit = 'day' }: { data: TrendPoint[]; height?: number; unit?: 'day' | 'week' }) {
  const id = useId()
  return (
    <div>
      <Legend items={SERIES.map((s) => ({ label: s.label, color: s.color }))} />
      <div className="mt-4" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <defs>
              {SERIES.map((s) => (
                <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 4" />
            <XAxis dataKey="date" tickFormatter={fmt} tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={40} tickMargin={8} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} width={48} />
            <Tooltip
              cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard
                    title={unit === 'week' ? `Week of ${fmt(String(label))}` : fmt(String(label))}
                    rows={SERIES.map((s) => ({ label: s.label, color: s.color, value: payload.find((p) => p.dataKey === s.key)?.value ?? 0 }))}
                  />
                ) : null
              }
            />
            {SERIES.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#${id}-${s.key})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
                isAnimationActive
                animationDuration={600}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        caption={`Issues reported and resolved per ${unit}`}
        headers={[unit === 'week' ? 'Week starting' : 'Date', 'Reported', 'Resolved']}
        rows={data.map((p) => [p.date, p.reported, p.resolved])}
      />
    </div>
  )
}
