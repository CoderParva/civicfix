import axios from 'axios'
import { lazy, Suspense } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PriorityBadge } from '@/features/issues/components/PriorityBadge'
import { StatusBadge } from '@/features/issues/components/StatusBadge'
import { useIssue } from '@/features/issues/hooks'
import { getApiErrorMessage } from '@/services/apiClient'
import { cn } from '@/utils/cn'
import { formatDate } from '@/utils/format'

const IssueLocationMap = lazy(() => import('@/features/map/IssueLocationMap'))

export function IssueDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const issue = useIssue(id)

  // location.key is "default" when this page was opened directly (no history to go back to).
  const back = () => (location.key === 'default' ? navigate('/explore') : navigate(-1))

  if (issue.isPending) {
    return (
      <div role="status" aria-label="Loading issue" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (issue.isError) {
    const notFound = axios.isAxiosError(issue.error) && issue.error.response?.status === 404
    return notFound ? (
      <EmptyState
        title="Issue not found"
        description="It may have been removed, or it is not public yet."
        action={
          <Link to="/explore" className={cn(buttonVariants())}>
            Explore issues
          </Link>
        }
      />
    ) : (
      <ErrorState message={getApiErrorMessage(issue.error)} onRetry={() => issue.refetch()} />
    )
  }

  const data = issue.data
  return (
    <article className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" onClick={back} className="-ml-3">
          ← Back
        </Button>
      </div>

      {data.moderation_status === 'pending' && (
        <Alert variant="warning">Only you can see this report for now. It becomes public once it has been reviewed.</Alert>
      )}
      {data.moderation_status === 'rejected' && <Alert variant="destructive">This report was not approved for public listing.</Alert>}

      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{data.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={data.status} />
          <PriorityBadge priority={data.priority} />
          <span className="text-sm text-muted-foreground">{data.category.name}</span>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="font-medium text-foreground">Reference</dt>
            <dd>{data.reference_number}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-foreground">Reported</dt>
            <dd>{formatDate(data.created_at)}</dd>
          </div>
          {data.resolved_at && (
            <div className="flex gap-2">
              <dt className="font-medium text-foreground">Resolved</dt>
              <dd>{formatDate(data.resolved_at)}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="font-medium text-foreground">Votes</dt>
            <dd>{data.vote_count}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-foreground">Comments</dt>
            <dd>{data.comment_count}</dd>
          </div>
        </dl>
      </header>

      <section aria-label="Description">
        <p className="whitespace-pre-line">{data.description}</p>
      </section>

      {data.images.length > 0 && (
        <section aria-label="Photos" className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Photos</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.images.map((image) => (
              <li key={image.id} className="overflow-hidden rounded-lg border">
                <img
                  src={image.url}
                  alt={image.image_type === 'resolution' ? `Resolution photo for ${data.title}` : `Photo of ${data.title}`}
                  className="aspect-video w-full object-cover"
                  loading="lazy"
                />
                {image.image_type === 'resolution' && <p className="px-2 py-1 text-xs text-muted-foreground">Resolution photo</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Location" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Location</h2>
        <p className="text-sm text-muted-foreground">
          {[data.address, data.landmark && `Near ${data.landmark}`].filter(Boolean).join(' · ') || 'No address given'}
          {' · '}
          <span data-testid="coordinates">
            {data.location.latitude.toFixed(5)}, {data.location.longitude.toFixed(5)}
          </span>
        </p>
        <Suspense fallback={<Skeleton role="status" aria-label="Loading map" className="h-64 rounded-xl" />}>
          <IssueLocationMap latitude={data.location.latitude} longitude={data.location.longitude} categoryId={data.category.id} />
        </Suspense>
      </section>
    </article>
  )
}
