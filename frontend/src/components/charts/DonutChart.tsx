import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { ChartDataTable, TooltipCard } from './chartParts'

export interface Slice {
  key: string
  label: string
  value: number
  color: string
}

interface DonutChartProps {
  slices: Slice[]
  /** Shown in the hole, e.g. "Issues". */
  centerLabel: string
  caption: string
}

/** A donut with the total in the middle and a legend that doubles as the numbers (value + share). */
export function DonutChart({ slices, centerLabel, caption }: DonutChartProps) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const visible = slices.filter((s) => s.value > 0)
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      <div className="relative size-[160px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={visible.length ? visible : [{ key: 'none', label: 'None', value: 1, color: 'var(--muted)' }]}
              dataKey="value"
              nameKey="label"
              innerRadius="70%"
              outerRadius="100%"
              paddingAngle={visible.length > 1 ? 3 : 0}
              cornerRadius={4}
              stroke="none"
              startAngle={90}
              endAngle={-270}
              animationDuration={600}
            >
              {(visible.length ? visible : [{ key: 'none', color: 'var(--muted)' }]).map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                const item = active ? (payload?.[0]?.payload as Slice | undefined) : undefined
                return item && item.key !== 'none' ? (
                  <TooltipCard rows={[{ label: item.label, color: item.color, value: `${item.value} · ${Math.round((item.value / total) * 100)}%` }]} />
                ) : null
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="type-stat leading-none">{total}</span>
          <span className="type-caption mt-1">{centerLabel}</span>
        </div>
      </div>
      <ul className="type-body flex w-full min-w-0 flex-1 flex-col gap-2" aria-label="Breakdown">
        {slices.map((s) => (
          <li key={s.key} className={`flex items-center justify-between gap-4 ${s.value === 0 ? "opacity-45" : ""}`}>
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="leading-snug">{s.label}</span>
            </span>
            <span className="tabular shrink-0 font-medium text-foreground">
              {s.value}
              <span className="type-caption ml-2 inline-block w-8 text-right">{total ? `${Math.round((s.value / total) * 100)}%` : '0%'}</span>
            </span>
          </li>
        ))}
      </ul>
      <ChartDataTable caption={caption} headers={['Name', 'Count']} rows={slices.map((s) => [s.label, s.value])} />
    </div>
  )
}
