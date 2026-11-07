import { lazy, Suspense, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import axios from 'axios'

import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { LoadingSkeleton } from '@/components/LoadingSkeleton'
import { Pagination } from '@/components/Pagination'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ExploreFilters } from '@/features/issues/components/ExploreFilters'
import { IssueCard } from '@/features/issues/components/IssueCard'
import { hasActiveFilters, parseExploreParams, toSearchParams, type ExploreState, type ExploreView } from '@/features/issues/explore'
import { useCategories, useExploreIssues } from '@/features/issues/hooks'
import { getApiErrorMessage } from '@/services/apiClient'
import { PAGE_SIZE } from '@/services/issuesApi'
import { cn } from '@/utils/cn'

// Leaflet + MapLibre are heavy and only needed here, so they load on demand.
const MapView = lazy(() => import('@/features/map/MapView'))

const VIEWS: { value: ExploreView; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'map', label: 'Map' },
]

export function ExplorePage() {
  const [params, setParams] = useSearchParams()
  const state = parseExploreParams(params)
  const categories = useCategories()
  const data = useExploreIssues(state)

  /** Change part of the state. Filters reset to page 1; typing replaces history instead of piling it up. */
  function update(patch: Partial<ExploreState>, opts: { resetPage?: boolean; replace?: boolean } = {}) {
    const next = { ...state, ...patch, page: opts.resetPage === false ? (patch.page ?? state.page) : 1 }
    setParams(toSearchParams(next), { replace: opts.replace ?? false })
  }

  // A stale/hand-edited page number past the end comes back as a 404: fall back to page 1.
  const outOfRange = data.isError && axios.isAxiosError(data.error) && data.error.response?.status === 404 && state.page > 1
  useEffect(() => {
    if (outOfRange) setParams(toSearchParams({ ...state, page: 1 }), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the out-of-range signal
  }, [outOfRange])

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Explore issues</h1>
          <p className="text-sm text-muted-foreground">Everything reported in the city, as a list or on the map.</p>
        </div>
        <div role="group" aria-label="View" className="inline-flex rounded-md border p-0.5">
          {VIEWS.map((v) => (
            <Button
              key={v.value}
              size="sm"
              variant={state.view === v.value ? 'default' : 'ghost'}
              aria-pressed={state.view === v.value}
              onClick={() => update({ view: v.value }, { resetPage: false })}
            >
              {v.label}
            </Button>
          ))}
        </div>
      </div>

      <ExploreFilters
        state={state}
        categories={categories.data ?? []}
        canClear={hasActiveFilters(state)}
        onClear={() => setParams(toSearchParams({ ...state, q: '', category: '', status: '', priority: '', page: 1 }))}
        onChange={(key, value) => update({ [key]: value }, { replace: key === 'q' })}
      />

      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
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
