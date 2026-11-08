import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { AXIS_TICK, ChartDataTable, Legend, TooltipCard } from './chartParts'

export interface BarRow {
  label: string
  value: number
  color: string
}

const BAR_HEIGHT = 16
const ROW = 40

/** Horizontal bars for a ranked list (priority, category): label, rounded bar, the number at the end. */
export function HBarChart({ rows, caption, labelWidth = 88 }: { rows: BarRow[]; caption: string; labelWidth?: number }) {
  return (
    <div>
      <div style={{ height: Math.max(rows.length, 1) * ROW + 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap={12}>
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={labelWidth} tick={{ ...AXIS_TICK, fontSize: 13 }} />
            <Tooltip cursor={{ fill: 'var(--subtle)' }} content={({ active, payload }) => (active && payload?.[0] ? <TooltipCard rows={[{ label: String(payload[0].payload.label), color: payload[0].payload.color, value: payload[0].value as number }]} /> : null)} />
            <Bar dataKey="value" barSize={BAR_HEIGHT} radius={6} background={{ fill: 'var(--muted)', radius: 6 }} animationDuration={600}>
              {rows.map((row) => (
                <Cell key={row.label} fill={row.color} />
              ))}
              <LabelList dataKey="value" position="right" offset={8} className="tabular" style={{ fill: 'var(--foreground)', fontSize: 13, fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable caption={caption} headers={['Name', 'Count']} rows={rows.map((r) => [r.label, r.value])} />
    </div>
  )
}

export interface StackRow {
  label: string
  values: Record<string, number>
}

export interface StackSeries {
  key: string
  label: string
  color: string
}

/** Stacked horizontal bars: one row per entity (department), one segment per series. */
export function StackedBarChart({ rows, series, caption, labelWidth = 120 }: { rows: StackRow[]; series: StackSeries[]; caption: string; labelWidth?: number }) {
  const data = rows.map((r) => ({ label: r.label, ...r.values }))
  return (
    <div>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <div className="mt-4" style={{ height: Math.max(rows.length, 1) * ROW + 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={12}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={labelWidth} tick={{ ...AXIS_TICK, fontSize: 13 }} />
            <Tooltip
              cursor={{ fill: 'var(--subtle)' }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard title={String(label)} rows={series.map((s) => ({ label: s.label, color: s.color, value: (payload.find((p) => p.dataKey === s.key)?.value as number) ?? 0 }))} />
                ) : null
              }
            />
            {series.map((s, index) => (
              <Bar key={s.key} dataKey={s.key} stackId="stack" fill={s.color} barSize={BAR_HEIGHT} radius={index === series.length - 1 ? [0, 6, 6, 0] : index === 0 ? [6, 0, 0, 6] : 0} animationDuration={600} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable caption={caption} headers={['Name', ...series.map((s) => s.label)]} rows={rows.map((r) => [r.label, ...series.map((s) => r.values[s.key] ?? 0)])} />
    </div>
  )
}
