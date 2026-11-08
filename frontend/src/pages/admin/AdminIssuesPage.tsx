import { Check, Flag, SearchX } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { DataTable, parseOrdering, toOrdering, type Column, type SortState } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PriorityBadge } from '@/features/issues/components/PriorityBadge'
import { StatusBadge } from '@/features/issues/components/StatusBadge'
import { EXPLORE_STATUSES } from '@/features/issues/explore'
import { useCategories } from '@/features/issues/hooks'
import { useAdminIssues, useApproveIssue } from '@/features/staff/hooks'
import { Age, IssueIdentity, ListFooter, ModerationBadge } from '@/features/staff/IssueParts'
import { getApiErrorMessage } from '@/services/apiClient'
import type { AdminIssue } from '@/types/staff'
import { cn } from '@/utils/cn'

const DEFAULT_SORT: SortState = { key: 'created_at', direction: 'desc' }
const SORT_KEYS = ['created_at', 'title', 'status', 'priority', 'votes', 'reports']
const MODERATION = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Awaiting review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]
const SELECT_CLASS =
  'h-9 min-w-40 rounded-md border border-input bg-surface px-3 text-sm shadow-xs outline-none transition-colors hover:bg-subtle focus-visible:ring-[3px] focus-visible:ring-ring/50'

export function AdminIssuesPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const categories = useCategories()
  const approve = useApproveIssue()

  const moderation = MODERATION.some((m) => m.value === params.get('moderation_status')) ? (params.get('moderation_status') ?? '') : ''
  const status = EXPLORE_STATUSES.concat([{ value: 'rejected', label: 'Rejected' }]).some((s) => s.value === params.get('status')) ? (params.get('status') ?? '') : ''
  const category = /^\d+$/.test(params.get('category') ?? '') ? params.get('category')! : ''
  const flagged = params.get('flagged') === 'true'
  const sort = parseOrdering(SORT_KEYS.includes((params.get('ordering') ?? '').replace(/^-/, '')) ? params.get('ordering') : null, DEFAULT_SORT)
  const page = Math.max(1, Number(params.get('page')) || 1)

  const issues = useAdminIssues({ moderation_status: moderation, status, category, flagged, ordering: toOrdering(sort), page })

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!('page' in patch)) next.delete('page') // any filter/sort change starts from page 1
    setParams(next)
  }
  const filtering = Boolean(moderation || status || category || flagged)

  const columns: Column<AdminIssue>[] = [
    { id: 'issue', header: 'Issue', sortKey: 'title', cell: (i) => <IssueIdentity issue={i} to={`/admin/issues/${i.id}`} />, className: 'max-w-[300px]' },
    {
      id: 'reporter',
      header: 'Reporter',
      hideBelow: 'xl',
      cell: (i) => (
        <span className="type-body block max-w-[140px] truncate text-muted-foreground" title={i.reporter.email}>
          {i.reporter.full_name}
        </span>
      ),
    },
    {
      // Moderation first: an unreviewed issue's lifecycle status is always "Reported", which says nothing.
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (i) => (i.moderation_status === 'pending' ? <ModerationBadge status="pending" /> : <StatusBadge status={i.status} />),
    },
    { id: 'priority', header: 'Priority', sortKey: 'priority', hideBelow: 'md', cell: (i) => <PriorityBadge priority={i.priority} compact /> },
    { id: 'department', header: 'Department', hideBelow: 'xl', cell: (i) => <span className="text-muted-foreground">{i.assignment?.department.name ?? '—'}</span> },
    {
      id: 'flags',
      header: 'Flags',
      sortKey: 'reports',
      align: 'right',
      hideBelow: 'md',
      cell: (i) =>
        i.report_count > 0 ? (
          <span data-tone="danger" className="tone-text inline-flex items-center gap-1 font-medium">
            <Flag aria-hidden className="size-3.5" />
            {i.report_count}
          </span>
        ) : (
          <span className="text-muted-foreground/60">0</span>
        ),
    },
    { id: 'reported', header: 'Reported', sortKey: 'created_at', hideBelow: 'md', cell: (i) => <Age iso={i.created_at} /> },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (i) =>
        i.moderation_status === 'pending' && i.status === 'reported' ? (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Approve ${i.title}`}
            onClick={(e) => {
              e.stopPropagation() // do not open the row
              approve.mutate(i.id)
            }}
            disabled={approve.isPending}
            className="transition-colors hover:border-[color-mix(in_oklab,var(--status-resolved)_40%,white)] hover:bg-[color-mix(in_oklab,var(--status-resolved)_8%,white)]"
          >
            <Check aria-hidden />
            Approve
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Issues" description="Every report on the platform, whatever its moderation state. Filter, sort, and open one to moderate, assign or reopen it." />

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="type-caption font-medium">Moderation</span>
          <SegmentedControl label="Moderation" value={moderation} options={MODERATION} onChange={(v) => update({ moderation_status: v || undefined })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-status" className="type-caption">
            Status
          </Label>
          <select id="f-status" className={SELECT_CLASS} value={status} onChange={(e) => update({ status: e.target.value || undefined })}>
            <option value="">All statuses</option>
            {EXPLORE_STATUSES.concat([{ value: 'rejected', label: 'Rejected' }]).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-category" className="type-caption">
            Category
          </Label>
          <select id="f-category" className={SELECT_CLASS} value={category} onChange={(e) => update({ category: e.target.value || undefined })}>
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="outline"
          aria-pressed={flagged}
          onClick={() => update({ flagged: flagged ? undefined : 'true' })}
          className={cn(flagged && 'border-[color-mix(in_oklab,var(--status-rejected)_40%,white)] bg-[color-mix(in_oklab,var(--status-rejected)_8%,white)] text-[color-mix(in_oklab,var(--status-rejected)_80%,black)]')}
        >
          <Flag aria-hidden />
          Flagged only
        </Button>
        {filtering && (
          <Button variant="ghost" onClick={() => setParams(new URLSearchParams())}>
            Clear filters
          </Button>
        )}
      </div>

      {issues.isError ? (
        <ErrorState message={getApiErrorMessage(issues.error)} onRetry={() => issues.refetch()} />
      ) : (
        <DataTable
          label="All issues"
          columns={columns}
          rows={issues.data?.results ?? []}
          rowKey={(i) => i.id}
          sort={sort}
          onSortChange={(next) => update({ ordering: toOrdering(next) })}
          loading={issues.isPending}
          refreshing={issues.isPlaceholderData}
          onRowClick={(i) => navigate(`/admin/issues/${i.id}`)}
          empty={<EmptyState icon={SearchX} title="No issues match" description={filtering ? 'Try removing a filter.' : 'Nothing has been reported yet.'} />}
          footer={issues.data && <ListFooter page={page} total={issues.data.count} shown={issues.data.results.length} onPageChange={(p) => update({ page: p > 1 ? String(p) : undefined })} />}
        />
      )}
    </div>
  )
}

