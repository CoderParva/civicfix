import { CheckCircle2, CornerUpLeft, Inbox, Timer } from 'lucide-react'

import { HBarChart } from '@/components/charts/BarCharts'
import { DonutChart } from '@/components/charts/DonutChart'
import { ChartCard } from '@/components/charts/chartParts'
import { TrendChart } from '@/components/charts/TrendChart'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { StatTile } from '@/components/StatTile'
import { Skeleton } from '@/components/ui/skeleton'
import { categorySlices, priorityRows, statusSlices, toWeekly } from '@/features/staff/analytics'
import { useOfficerAnalytics } from '@/features/staff/hooks'
import { getApiErrorMessage } from '@/services/apiClient'
import { formatHours } from '@/utils/format'

const RANGE_DAYS = 90

export function OfficerAnalyticsPage() {
  const analytics = useOfficerAnalytics(RANGE_DAYS)
  const data = analytics.data

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Department analytics"
        description={data ? `How ${data.department.name} is doing: queue size, turnaround and where the work comes from.` : 'How your department is doing.'}
      />

      {analytics.isError ? (
        <ErrorState message={getApiErrorMessage(analytics.error)} onRetry={() => analytics.refetch()} />
      ) : (
        <>
          <section aria-label="Department totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Average turnaround" value={formatHours(data?.totals.avg_resolution_hours)} icon={Timer} tone="primary" hint="From assignment to resolution" loading={!data} testId="tile-turnaround" />
            <StatTile label="Resolved" value={data?.totals.resolved ?? 0} icon={CheckCircle2} tone="resolved" hint="Currently marked resolved" loading={!data} testId="tile-resolved" />
            <StatTile label="In your queue" value={data?.totals.in_queue ?? 0} icon={Inbox} tone="assigned" hint="Open and finished, together" loading={!data} testId="tile-queue" />
            <StatTile label="Sent back" value={data?.totals.rejected_assignments ?? 0} icon={CornerUpLeft} tone="reopened" hint="Assignments returned to the admin" loading={!data} testId="tile-sent-back" />
          </section>

          <ChartCard title="Reported vs resolved" description="Weekly, for the issues in your queue over the last 90 days" testId="chart-trend">
            {data ? <TrendChart data={toWeekly(data.over_time)} unit="week" /> : <Skeleton className="h-64 w-full" />}
          </ChartCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="By status" description="Where your issues stand right now" testId="chart-status">
              {data ? <DonutChart slices={statusSlices(data.by_status)} centerLabel="Issues" caption="Queue by status" /> : <Skeleton className="h-44 w-full" />}
            </ChartCard>
            <ChartCard title="By category" description="What kind of work comes your way" testId="chart-category">
              {data ? <DonutChart slices={categorySlices(data.by_category).filter((s) => s.value > 0)} centerLabel="Issues" caption="Queue by category" /> : <Skeleton className="h-44 w-full" />}
            </ChartCard>
          </div>

          <ChartCard title="By priority" description="How urgent the queue is" testId="chart-priority">
            {data ? <HBarChart rows={priorityRows(data.by_priority).reverse()} caption="Queue by priority" /> : <Skeleton className="h-44 w-full" />}
          </ChartCard>
        </>
      )}
    </div>
  )
}
