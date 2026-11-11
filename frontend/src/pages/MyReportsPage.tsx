import { ArrowRight, FilePlus2 } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { PageBanner } from '@/components/civic/PageBanner'
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
      <PageBanner
        title="My reports"
        description="Every report you have made, and where it stands."
        actions={
          <Link to="/report" className={cn(buttonVariants({ variant: 'brand', size: 'lg' }), 'h-12 rounded-2xl px-6')}>
            Report an issue
            <ArrowRight aria-hidden className="size-5" />
          </Link>
        }
      />

      {notice && <Alert variant={notice.kind}>{notice.message}</Alert>}

      {issues.isPending && <LoadingSkeleton label="Loading your reports" />}
      {issues.isError && <ErrorState message={getApiErrorMessage(issues.error)} onRetry={() => issues.refetch()} />}
      {issues.isSuccess &&
        (issues.data.length === 0 ? (
          <EmptyState
            icon={FilePlus2}
            tone="primary"
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
