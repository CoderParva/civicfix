import { ArrowRight, Megaphone } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PageBanner } from '@/components/civic/PageBanner'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/context/AuthContext'
import { IssueCard } from '@/features/issues/components/IssueCard'
import { StatsGrid } from '@/features/issues/components/StatsGrid'
import { useMyIssues } from '@/features/issues/hooks'
import { computeStats } from '@/features/issues/tally'
import { getApiErrorMessage } from '@/services/apiClient'
import { cn } from '@/utils/cn'

export function DashboardPage() {
  const { user } = useAuth()
  const issues = useMyIssues()

  return (
    <div className="flex flex-col gap-8">
      <PageBanner
        title={`Hello, ${user?.full_name}`}
        description="Here is where your reports stand."
        actions={
          <Link to="/report" className={cn(buttonVariants({ variant: 'brand', size: 'lg' }), 'h-12 rounded-2xl px-6')}>
            Report an issue
            <ArrowRight aria-hidden className="size-5" />
          </Link>
        }
      />

      {issues.isPending && (
        <div role="status" aria-label="Loading statistics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}
      {issues.isError && <ErrorState message={getApiErrorMessage(issues.error)} onRetry={() => issues.refetch()} />}
      {issues.isSuccess && <DashboardBody issues={issues.data} />}
    </div>
  )
}

function DashboardBody({ issues }: { issues: NonNullable<ReturnType<typeof useMyIssues>['data']> }) {
  const stats = computeStats(issues)
  const recent = issues.slice(0, 3) // the API returns newest first
  return (
    <>
      <StatsGrid stats={stats} />
      {stats.rejected > 0 && (
        <p className="-mt-4 text-xs text-muted-foreground">
          {stats.rejected} of your reports {stats.rejected === 1 ? 'was' : 'were'} not accepted and {stats.rejected === 1 ? 'is' : 'are'} not counted above.
        </p>
      )}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-extrabold tracking-tight">Recent reports</h2>
          {issues.length > 0 && (
            <Link to="/my-reports" className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline">
              View all
            </Link>
          )}
        </div>
        {issues.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            tone="primary"
            title="You have not reported anything yet"
            description="Spotted a pothole, a broken streetlight or a garbage pile? Tell the city."
            action={
              <Link to="/report" className={cn(buttonVariants())}>
                Report your first issue
              </Link>
            }
          />
        ) : (
          recent.map((issue) => <IssueCard key={issue.id} issue={issue} />)
        )}
      </section>
    </>
  )
}
