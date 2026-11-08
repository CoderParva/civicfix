import { ArrowRight, CheckCircle2, ClipboardList, Flag, Loader2, PartyPopper, ShieldAlert, Timer } from 'lucide-react'
import { Link } from 'react-router-dom'

import { HBarChart, StackedBarChart } from '@/components/charts/BarCharts'
import { DonutChart } from '@/components/charts/DonutChart'
import { ChartCard } from '@/components/charts/chartParts'
import { TrendChart } from '@/components/charts/TrendChart'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { StatTile } from '@/components/StatTile'
import { buttonVariants } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/context/AuthContext'
import { categorySlices, chartableDepartments, priorityRows, toWeekly } from '@/features/staff/analytics'
import { useAdminAnalytics, useAdminIssues } from '@/features/staff/hooks'
import { AttentionRow } from '@/features/staff/IssueParts'
import { getApiErrorMessage } from '@/services/apiClient'
import { cn } from '@/utils/cn'
import { formatHours, formatRelative, greeting } from '@/utils/format'

const RANGE_DAYS = 90

export function AdminDashboardPage() {
  const { user } = useAuth()
  const analytics = useAdminAnalytics(RANGE_DAYS)
  const pending = useAdminIssues({ moderation_status: 'pending', ordering: '-priority' })
  const data = analytics.data
  const totals = data?.totals
  const departments = data ? chartableDepartments(data.departments) : []

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`${greeting()}, ${user?.full_name.split(' ')[0] ?? ''}`}
        description="What needs a decision, how fast issues get fixed, and how each department is doing."
        actions={
          <Link to="/admin/issues?moderation_status=pending" className={cn(buttonVariants())}>
            Review queue
            <ArrowRight aria-hidden />
          </Link>
        }
      />

      {analytics.isError ? (
        <ErrorState message={getApiErrorMessage(analytics.error)} onRetry={() => analytics.refetch()} />
      ) : (
        <section aria-label="Platform overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatTile label="Total issues" value={totals?.issues ?? 0} icon={ClipboardList} tone="primary" hint="Every report, all time" to="/admin/issues" loading={!totals} testId="tile-total" />
          <StatTile
            label="Awaiting moderation"
            value={totals?.awaiting_moderation ?? 0}
            icon={ShieldAlert}
            tone="warning"
            attention={(totals?.awaiting_moderation ?? 0) > 0}
            hint={(totals?.awaiting_moderation ?? 0) > 0 ? 'Approve or reject to move them on' : 'Nothing to review'}
            to="/admin/issues?moderation_status=pending"
            loading={!totals}
            testId="tile-moderation"
          />
          <StatTile label="Open issues" value={totals?.open ?? 0} icon={Loader2} tone="in_progress" hint="Approved and not yet resolved" to="/admin/issues?moderation_status=approved" loading={!totals} testId="tile-open" />
          <StatTile label="Resolved" value={totals?.resolved ?? 0} icon={CheckCircle2} tone="resolved" hint="Fixed, with proof" to="/admin/issues?status=resolved" loading={!totals} testId="tile-resolved" />
          <StatTile label="Average resolution time" value={formatHours(totals?.avg_resolution_hours)} icon={Timer} tone="primary" hint="From report to resolution" loading={!totals} testId="tile-avg" />
          <StatTile
            label="Flagged by residents"
            value={totals?.flagged ?? 0}
            icon={Flag}
            tone="danger"
            attention={(totals?.flagged ?? 0) > 0}
            hint={(totals?.flagged ?? 0) > 0 ? 'Reported as spam or inappropriate' : 'Nothing flagged'}
            to="/admin/issues?flagged=true"
            loading={!totals}
            testId="tile-flagged"
          />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel className="overflow-hidden lg:col-span-3" aria-label="Needs moderation">
          <PanelHeader
            title="Needs moderation"
            description="New reports waiting for a decision, most urgent first."
            actions={
              <Link to="/admin/issues?moderation_status=pending" className="type-body font-medium text-primary underline-offset-4 hover:underline">
                View all
              </Link>
            }
            className="pb-4"
          />
          <div className="border-t">
            {pending.isPending && (
              <div role="status" aria-label="Loading issues" className="flex flex-col gap-4 p-6">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}
            {pending.isError && (
              <div className="p-6">
                <ErrorState message={getApiErrorMessage(pending.error)} onRetry={() => pending.refetch()} />
              </div>
            )}
            {pending.isSuccess && pending.data.results.length === 0 && (
              <EmptyState icon={PartyPopper} tone="success" title="The queue is clear" description="Every report has been reviewed. New ones will appear here." />
            )}
            {pending.isSuccess && pending.data.results.length > 0 && (
              <ul className="divide-y">
                {pending.data.results.slice(0, 5).map((issue) => (
                  <AttentionRow key={issue.id} issue={issue} to={`/admin/issues/${issue.id}`} context={`${issue.category.name} · reported ${formatRelative(issue.created_at)} by ${issue.reporter.full_name}`} />
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <ChartCard title="By priority" description="Every issue, by urgency" className="lg:col-span-2" testId="chart-priority">
          {data ? <HBarChart rows={priorityRows(data.by_priority).reverse()} caption="Issues by priority" /> : <Skeleton className="h-44 w-full" />}
        </ChartCard>
      </div>

      <ChartCard title="Reported vs resolved" description="Weekly, platform-wide, over the last 90 days" testId="chart-trend">
        {data ? <TrendChart data={toWeekly(data.over_time)} unit="week" /> : <Skeleton className="h-64 w-full" />}
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-5">
        <ChartCard title="By category" description="What residents report" className="lg:col-span-2" testId="chart-category">
          {data ? <DonutChart slices={categorySlices(data.by_category).filter((s) => s.value > 0)} centerLabel="Issues" caption="Issues by category" /> : <Skeleton className="h-44 w-full" />}
        </ChartCard>

        <ChartCard title="Department performance" description="Where each department’s queue stands. Average resolution times are on the Departments page." className="lg:col-span-3" testId="chart-departments">
          {data ? (
            <>
              <StackedBarChart
                caption="Department queues by state"
                series={[
                  { key: 'resolved', label: 'Resolved', color: 'var(--status-resolved)' },
                  { key: 'in_progress', label: 'In progress', color: 'var(--status-in_progress)' },
                  { key: 'waiting', label: 'Waiting', color: 'var(--status-assigned)' },
                ]}
                rows={departments.map((d) => ({
                  label: d.name,
                  values: { resolved: d.resolved, in_progress: d.in_progress, waiting: Math.max(0, d.in_queue - d.resolved - d.in_progress) },
                }))}
              />
            </>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </ChartCard>
      </div>
    </div>
  )
}
