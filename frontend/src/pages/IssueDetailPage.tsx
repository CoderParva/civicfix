import axios from 'axios'
import { Calendar, CheckCircle2, Hash, Images, MapPin, MessageSquare, ThumbsUp, type LucideIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { categoryIcon, categoryStyle } from '@/features/issues/categoryVisual'
import { PriorityBadge } from '@/features/issues/components/PriorityBadge'
import { StatusBadge } from '@/features/issues/components/StatusBadge'
import { useIssue } from '@/features/issues/hooks'
import { getApiErrorMessage } from '@/services/apiClient'
import { cn } from '@/utils/cn'
import { formatDate } from '@/utils/format'

/** A fact tile on the colour banner: icon, term, value. Keeps the dt/dd pairing for assistive technology. */
function Fact({ icon: Icon, term, value }: { icon: LucideIcon; term: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/15 p-3 ring-1 ring-white/25 backdrop-blur">
      <Icon aria-hidden className="size-5 shrink-0 text-white" />
      <div className="min-w-0">
        <dt className="text-xs font-medium text-white/80">{term}</dt>
        <dd className="truncate font-bold text-white">{value}</dd>
      </div>
    </div>
  )
}

function CategoryGlyph({ category, className }: { category: { name: string; icon: string }; className?: string }) {
  const Icon = categoryIcon(category)
  return <Icon aria-hidden className={className} />
}

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
        <Button variant="ghost" size="sm" onClick={back} className="-ml-3 rounded-full">
          ← Back
        </Button>
      </div>

      {data.moderation_status === 'pending' && (
        <Alert variant="warning">Only you can see this report for now. It becomes public once it has been reviewed.</Alert>
      )}
      {data.moderation_status === 'rejected' && <Alert variant="destructive">This report was not approved for public listing.</Alert>}

      <header className="cat-banner flex flex-col gap-5 rounded-3xl p-6 sm:p-8" style={categoryStyle(data.category.id)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm font-bold text-[color-mix(in_oklab,var(--cat)_72%,black)] shadow-sm">
            <CategoryGlyph category={data.category} className="size-4" />
            {data.category.name}
          </span>
          <StatusBadge status={data.status} className="bg-white" />
          <PriorityBadge priority={data.priority} className="bg-white" />
        </div>
        <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight text-balance sm:text-5xl">{data.title}</h1>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <Fact icon={Hash} term="Reference" value={data.reference_number} />
          <Fact icon={Calendar} term="Reported" value={formatDate(data.created_at)} />
          {data.resolved_at && <Fact icon={CheckCircle2} term="Resolved" value={formatDate(data.resolved_at)} />}
          <Fact icon={ThumbsUp} term="Votes" value={data.vote_count} />
          <Fact icon={MessageSquare} term="Comments" value={data.comment_count} />
        </dl>
      </header>

      <section aria-label="Description">
        <p className="rounded-3xl border bg-card p-6 text-lg leading-relaxed whitespace-pre-line shadow-sm">{data.description}</p>
      </section>

      {data.images.length > 0 && (
        <section aria-label="Photos" className="flex flex-col gap-2">
          <h2 className="font-display flex items-center gap-2 text-2xl font-extrabold tracking-tight"><Images aria-hidden className="size-6 text-primary" />Photos</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.images.map((image) => (
              <li key={image.id} className="group overflow-hidden rounded-2xl border bg-card shadow-sm">
                <img
                  src={image.url}
                  alt={image.image_type === 'resolution' ? `Resolution photo for ${data.title}` : `Photo of ${data.title}`}
                  className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
                {image.image_type === 'resolution' && <p className="px-2 py-1 text-xs text-muted-foreground">Resolution photo</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Location" className="flex flex-col gap-2">
        <h2 className="font-display flex items-center gap-2 text-2xl font-extrabold tracking-tight"><MapPin aria-hidden className="size-6 text-primary" />Location</h2>
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
