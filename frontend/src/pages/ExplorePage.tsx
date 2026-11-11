import { List, Map as MapIcon, SearchX, type LucideIcon } from 'lucide-react'
import { lazy, Suspense, useEffect } from 'react'
import axios from 'axios'

import { PageBanner } from '@/components/civic/PageBanner'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { LoadingSkeleton } from '@/components/LoadingSkeleton'
import { Pagination } from '@/components/Pagination'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ExploreFilters } from '@/features/issues/components/ExploreFilters'
import { IssueCard } from '@/features/issues/components/IssueCard'
import { hasActiveFilters, type ExploreView } from '@/features/issues/explore'
import { useCategories, useExploreIssues } from '@/features/issues/hooks'
import { useExploreState } from '@/features/issues/useExploreState'
import { getApiErrorMessage } from '@/services/apiClient'
import { PAGE_SIZE } from '@/services/issuesApi'
import { cn } from '@/utils/cn'

// Leaflet + MapLibre are heavy and only needed here, so they load on demand.
const MapView = lazy(() => import('@/features/map/MapView'))

const VIEWS: { value: ExploreView; label: string; icon: LucideIcon }[] = [
  { value: 'list', label: 'List', icon: List },
  { value: 'map', label: 'Map', icon: MapIcon },
]

export function ExplorePage() {
  const { state, update, clear, backToFirstPage } = useExploreState()
  const categories = useCategories()
  const data = useExploreIssues(state)

  // A stale/hand-edited page number past the end comes back as a 404: fall back to page 1.
  const outOfRange = data.isError && axios.isAxiosError(data.error) && data.error.response?.status === 404 && state.page > 1
  useEffect(() => {
    if (outOfRange) backToFirstPage()
  }, [outOfRange, backToFirstPage])

  const first = (state.page - 1) * PAGE_SIZE + 1
  const last = first + data.issues.length - 1
  const summary = data.isPending
    ? 'Loading issues…'
    : data.total === 0
      ? 'No issues found'
      : state.view === 'map'
        ? `${data.total} ${data.total === 1 ? 'issue' : 'issues'} on the map`
        : `Showing ${first}–${last} of ${data.total} issues`

  return (
    <div className="flex flex-col gap-5">
      <PageBanner
        title="Explore issues"
        description="Everything reported in the city, as a list or on the map."
        actions={
          <div role="group" aria-label="View" className="inline-flex rounded-full bg-white/15 p-1 ring-1 ring-white/25 backdrop-blur">
            {VIEWS.map((v) => (
              <Button
                key={v.value}
                size="sm"
                variant="ghost"
                aria-pressed={state.view === v.value}
                onClick={() => update({ view: v.value }, { resetPage: false })}
                className={cn(
                  'h-10 rounded-full px-5 text-white hover:bg-white/20 hover:text-white',
                  state.view === v.value && 'bg-white text-primary shadow-md hover:bg-white hover:text-primary',
                )}
              >
                <v.icon aria-hidden className="size-4" />
                {v.label}
              </Button>
            ))}
          </div>
        }
      />

      <ExploreFilters
        state={state}
        categories={categories.data ?? []}
        canClear={hasActiveFilters(state)}
        onClear={clear}
        onChange={(key, value) => update({ [key]: value }, { replace: key === 'q' })}
      />

      <p role="status" aria-live="polite" className="text-sm font-semibold text-muted-foreground">
        {summary}
      </p>

      <div className={cn('flex flex-col gap-4', data.isPlaceholderData && 'opacity-60 transition-opacity')} aria-busy={data.isPlaceholderData}>
        {data.isPending &&
          (state.view === 'map' ? <Skeleton role="status" aria-label="Loading map" className="h-[28rem] rounded-xl" /> : <LoadingSkeleton label="Loading issues" />)}

        {data.isError && !outOfRange && <ErrorState message={getApiErrorMessage(data.error)} onRetry={() => data.refetch()} />}

        {!data.isPending && !data.isError && state.view === 'list' && (
          <>
            {data.issues.length === 0 ? (
              <EmptyState
                icon={SearchX}
                tone="primary"
                title="No issues match"
                description={hasActiveFilters(state) ? 'Try removing a filter or searching for something else.' : 'Nothing has been reported publicly yet.'}
              />
            ) : (
              <ul className="flex flex-col gap-3" aria-label="Issues">
                {data.issues.map((issue) => (
                  <li key={issue.id}>
                    <IssueCard issue={issue} />
                  </li>
                ))}
              </ul>
            )}
            <Pagination page={state.page} pageCount={data.pageCount} onPageChange={(page) => update({ page }, { resetPage: false })} />
          </>
        )}

        {!data.isPending && !data.isError && state.view === 'map' && (
          <>
            {data.truncated && (
              <p className="text-xs text-amber-700">Only the first 500 matching issues are on the map. Narrow the filters to see the rest.</p>
            )}
            <Suspense fallback={<Skeleton role="status" aria-label="Loading map" className="h-[28rem] rounded-xl" />}>
              <MapView issues={data.issues} categories={categories.data ?? []} />
            </Suspense>
          </>
        )}
      </div>
    </div>
  )
}
