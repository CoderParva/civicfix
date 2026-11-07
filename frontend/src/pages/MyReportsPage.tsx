import { Link, useLocation } from 'react-router-dom'

import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { LoadingSkeleton } from '@/components/LoadingSkeleton'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { IssueCard } from '@/features/issues/components/IssueCard'
import { useMyIssues } from '@/features/issues/hooks'
import { getApiErrorMessage } from '@/services/apiClient'
import { cn } from '@/utils/cn'

export interface ReportNotice {
  kind: 'success' | 'warning'
  message: string
}

export function MyReportsPage() {
  const issues = useMyIssues()
  const notice = (useLocation().state as { notice?: ReportNotice } | null)?.notice

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">My reports</h1>
        <Link to="/report" className={cn(buttonVariants())}>
          Report an issue
        </Link>
      </div>

      {notice && <Alert variant={notice.kind}>{notice.message}</Alert>}

      {issues.isPending && <LoadingSkeleton label="Loading your reports" />}
      {issues.isError && <ErrorState message={getApiErrorMessage(issues.error)} onRetry={() => issues.refetch()} />}
      {issues.isSuccess &&
        (issues.data.length === 0 ? (
          <EmptyState
            title="No reports yet"
            description="Once you report an issue it will show up here with its status."
            action={
              <Link to="/report" className={cn(buttonVariants())}>
                Report an issue
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Your reports">
            {issues.data.map((issue) => (
              <li key={issue.id}>
                <IssueCard issue={issue} />
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}
