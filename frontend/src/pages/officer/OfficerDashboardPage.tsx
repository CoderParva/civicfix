import { ArrowRight, CheckCircle2, Inbox, Loader2, PartyPopper, UserCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

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
import { statusSlices, toWeekly } from '@/features/staff/analytics'
import { useOfficerAnalytics, useOfficerIssues } from '@/features/staff/hooks'
import { AttentionRow } from '@/features/staff/IssueParts'
import { getApiErrorMessage } from '@/services/apiClient'
import { cn } from '@/utils/cn'
import { formatHours, formatRelative, greeting } from '@/utils/format'

const RANGE_DAYS = 56 // eight weeks

export function OfficerDashboardPage() {
  const { user } = useAuth()
  const analytics = useOfficerAnalytics(RANGE_DAYS)
  const waiting = useOfficerIssues({ status: 'assigned', ordering: '-priority' })
  const firstName = user?.full_name.split(' ')[0] ?? ''
  const totals = analytics.data?.totals

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={analytics.data ? `${analytics.data.department.name} · ${analytics.data.department.city}. Here is where your department's queue stands.` : "Here is where your department's queue stands."}
        actions={
          <Link to="/officer/issues" className={cn(buttonVariants())}>
            Open queue
            <ArrowRight aria-hidden />
          </Link>
        }
      />

      {analytics.isError ? (
        <ErrorState message={getApiErrorMessage(analytics.error)} onRetry={() => analytics.refetch()} />
      ) : (
        <section aria-label="Queue overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="In your queue" value={totals?.in_queue ?? 0} icon={Inbox} tone="primary" hint="Assigned to your department" to="/officer/issues" loading={!totals} testId="tile-in-queue" />
          <StatTile
            label="Awaiting acceptance"
            value={totals?.awaiting_acceptance ?? 0}
            icon={UserCheck}
            tone="assigned"
            attention={(totals?.awaiting_acceptance ?? 0) > 0}
            hint={(totals?.awaiting_acceptance ?? 0) > 0 ? 'Accept or send back' : 'Nothing is waiting'}
            to="/officer/issues?status=assigned"
            loading={!totals}
            testId="tile-awaiting"
          />
          <StatTile label="In progress" value={totals?.in_progress ?? 0} icon={Loader2} tone="in_progress" hint="Work underway" to="/officer/issues?status=in_progress" loading={!totals} testId="tile-in-progress" />
          <StatTile
            label="Resolved"
            value={totals?.resolved ?? 0}
            icon={CheckCircle2}
            tone="resolved"
            hint={totals ? `Average ${formatHours(totals.avg_resolution_hours)} to resolve` : undefined}
            to="/officer/issues?status=resolved"
            loading={!totals}
            testId="tile-resolved"
          />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel className="overflow-hidden lg:col-span-3" aria-label="Needs your attention">
          <PanelHeader
            title="Needs your attention"
            description="Issues assigned to you that nobody has accepted yet, most urgent first."
            actions={
              <Link to="/officer/issues?status=assigned" className="type-body font-medium text-primary underline-offset-4 hover:underline">
                View all
              </Link>
            }
            className="pb-4"
          />
          <div className="border-t">
            {waiting.isPending && (
              <div role="status" aria-label="Loading issues" className="flex flex-col gap-4 p-6">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}
            {waiting.isError && <div className="p-6"><ErrorState message={getApiErrorMessage(waiting.error)} onRetry={() => waiting.refetch()} /></div>}
            {waiting.isSuccess && waiting.data.results.length === 0 && (
              <EmptyState icon={PartyPopper} tone="success" title="You are all caught up" description="Nothing is waiting for you to accept. New assignments will show up here." />
            )}
            {waiting.isSuccess && waiting.data.results.length > 0 && (
              <ul className="divide-y">
                {waiting.data.results.slice(0, 5).map((issue) => (
                  <AttentionRow
                    key={issue.id}
                    issue={issue}
                    to={`/officer/issues/${issue.id}`}
                    context={`${issue.category.name} · assigned ${issue.assignment ? formatRelative(issue.assignment.assigned_at) : ''}`}
                  />
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <ChartCard title="Where issues stand" description="Everything in your queue by status" className="lg:col-span-2" testId="chart-status">
          {analytics.data ? <DonutChart slices={statusSlices(analytics.data.by_status)} centerLabel="In queue" caption="Queue by status" /> : <Skeleton className="h-44 w-full" />}
        </ChartCard>
      </div>

      <ChartCard title="Reported vs resolved" description="Weekly, for the issues in your queue over the last eight weeks" testId="chart-trend">
        {analytics.data ? <TrendChart data={toWeekly(analytics.data.over_time)} unit="week" /> : <Skeleton className="h-64 w-full" />}
      </ChartCard>
    </div>
  )
}
