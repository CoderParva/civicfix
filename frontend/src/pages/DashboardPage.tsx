import { Link } from 'react-router-dom'

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Hello, {user?.full_name}</h1>
          <p className="text-sm text-muted-foreground">Here is where your reports stand.</p>
        </div>
        <Link to="/report" className={cn(buttonVariants())}>
          Report an issue
        </Link>
      </div>

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
          <h2 className="text-lg font-semibold">Recent reports</h2>
          {issues.length > 0 && (
            <Link to="/my-reports" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              View all
            </Link>
          )}
        </div>
        {issues.length === 0 ? (
          <EmptyState
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
