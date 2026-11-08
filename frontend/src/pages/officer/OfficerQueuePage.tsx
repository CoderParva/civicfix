import { Inbox } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { DataTable, parseOrdering, toOrdering, type Column, type SortState } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { SegmentedControl } from '@/components/SegmentedControl'
import { PriorityBadge } from '@/features/issues/components/PriorityBadge'
import { StatusBadge } from '@/features/issues/components/StatusBadge'
import { EXPLORE_STATUSES } from '@/features/issues/explore'
import { useOfficerIssues } from '@/features/staff/hooks'
import { Age, CategoryTag, IssueIdentity, ListFooter } from '@/features/staff/IssueParts'
import { getApiErrorMessage } from '@/services/apiClient'
import type { OfficerIssue } from '@/types/staff'

const DEFAULT_SORT: SortState = { key: 'created_at', direction: 'desc' }
const SORT_KEYS = ['created_at', 'title', 'status', 'priority', 'votes']
const FILTERS = [
  { value: '', label: 'All' },
  { value: 'assigned', label: 'Awaiting acceptance' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
]

export function OfficerQueuePage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const status = EXPLORE_STATUSES.some((s) => s.value === params.get('status')) ? params.get('status')! : ''
  const sort = parseOrdering(SORT_KEYS.some((k) => params.get('ordering')?.replace(/^-/, '') === k) ? params.get('ordering') : null, DEFAULT_SORT)
  const page = Math.max(1, Number(params.get('page')) || 1)

  const issues = useOfficerIssues({ status, ordering: toOrdering(sort), page })

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next)
  }

  const columns: Column<OfficerIssue>[] = [
    { id: 'issue', header: 'Issue', sortKey: 'title', cell: (i) => <IssueIdentity issue={i} to={`/officer/issues/${i.id}`} />, className: 'max-w-[360px]' },
    { id: 'status', header: 'Status', sortKey: 'status', cell: (i) => <StatusBadge status={i.status} /> },
    { id: 'priority', header: 'Priority', sortKey: 'priority', cell: (i) => <PriorityBadge priority={i.priority} compact /> },
    { id: 'category', header: 'Category', hideBelow: 'md', cell: (i) => <CategoryTag issue={i} /> },
    { id: 'reported', header: 'Reported', sortKey: 'created_at', hideBelow: 'md', cell: (i) => <Age iso={i.created_at} /> },
    { id: 'votes', header: 'Votes', sortKey: 'votes', align: 'right', hideBelow: 'lg', cell: (i) => i.vote_count },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My queue" description="Every issue assigned to your department. Open one to accept it, work on it, add notes and resolve it." />

      <SegmentedControl label="Filter by status" value={status} options={FILTERS} onChange={(value) => update({ status: value || undefined, page: undefined })} />

      {issues.isError ? (
        <ErrorState message={getApiErrorMessage(issues.error)} onRetry={() => issues.refetch()} />
      ) : (
        <DataTable
          label="Assigned issues"
          columns={columns}
          rows={issues.data?.results ?? []}
          rowKey={(i) => i.id}
          sort={sort}
          onSortChange={(next) => update({ ordering: toOrdering(next), page: undefined })}
          loading={issues.isPending}
          refreshing={issues.isPlaceholderData}
          onRowClick={(i) => navigate(`/officer/issues/${i.id}`)}
          empty={
            <EmptyState
              icon={Inbox}
              title={status ? 'No issues with this status' : 'Your queue is empty'}
              description={status ? 'Try another filter.' : 'When an admin assigns an issue to your department it will appear here.'}
            />
          }
          footer={issues.data && <ListFooter page={page} total={issues.data.count} shown={issues.data.results.length} onPageChange={(p) => update({ page: p > 1 ? String(p) : undefined })} />}
        />
      )}
    </div>
  )
}
