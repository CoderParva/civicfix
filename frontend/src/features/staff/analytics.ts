import type { BarRow } from '@/components/charts/BarCharts'
import type { Slice } from '@/components/charts/DonutChart'
import type { TrendPoint } from '@/components/charts/TrendChart'
import { colorForCategory } from '@/features/map/palette'
import { PRIORITY_META, STATUS_META } from '@/features/issues/statusMeta'
import type { CategoryCount, DayPoint, DepartmentPerformance, PriorityCount, StatusCount } from '@/types/staff'

/** Monday of the week containing `iso` (local, no time zone surprises: pure date maths). */
export function weekStart(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const offset = (date.getUTCDay() + 6) % 7 // Mon=0 ... Sun=6
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

/** Daily counts -> weekly buckets (keyed by the Monday), in order. 90 daily points read as noise; 13 weeks read as a trend. */
export function toWeekly(points: DayPoint[]): TrendPoint[] {
  const weeks = new Map<string, TrendPoint>()
  for (const p of points) {
    const key = weekStart(p.date)
    const week = weeks.get(key) ?? { date: key, reported: 0, resolved: 0 }
    week.reported += p.reported
    week.resolved += p.resolved
    weeks.set(key, week)
  }
  return [...weeks.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export const statusSlices = (rows: StatusCount[]): Slice[] =>
  rows.map((r) => ({ key: r.status, label: STATUS_META[r.status].label, value: r.count, color: `var(--status-${r.status})` }))

export const priorityRows = (rows: PriorityCount[]): BarRow[] =>
  rows.map((r) => ({ label: PRIORITY_META[r.priority].label, value: r.count, color: `var(--priority-${r.priority})` }))

/** Category colours are the ones the map pins use, so a category looks the same everywhere. */
export const categorySlices = (rows: CategoryCount[]): Slice[] =>
  [...rows]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map((r) => ({ key: String(r.id), label: r.name, value: r.count, color: colorForCategory(r.id) }))

/** Departments worth charting: active ones, or any with work in their queue; busiest first. */
export function chartableDepartments(rows: DepartmentPerformance[]): DepartmentPerformance[] {
  return rows.filter((d) => d.is_active || d.in_queue > 0).sort((a, b) => b.in_queue - a.in_queue || a.name.localeCompare(b.name))
}

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
