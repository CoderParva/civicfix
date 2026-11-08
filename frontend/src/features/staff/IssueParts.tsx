import { Ban, ChevronRight, Clock, ImageOff, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Pagination } from '@/components/Pagination'
import { PriorityBadge } from '@/features/issues/components/PriorityBadge'
import { StatusBadge } from '@/features/issues/components/StatusBadge'
import { PRIORITY_META } from '@/features/issues/statusMeta'
import { colorForCategory } from '@/features/map/palette'
import { PAGE_SIZE } from '@/services/issuesApi'
import type { Issue, ModerationStatus } from '@/types/api'
import { cn } from '@/utils/cn'
import { formatRelative } from '@/utils/format'

/** Thumbnail + title + reference line: the first column of every staff issue table. */
export function IssueIdentity({ issue, to }: { issue: Issue; to: string }) {
  const photo = issue.images.find((i) => i.image_type === 'report') ?? issue.images[0]
  return (
    <div className="flex min-w-0 items-center gap-4">
      {photo ? (
        <img src={photo.url} alt="" loading="lazy" className="size-10 shrink-0 rounded-md object-cover ring-1 ring-border" />
      ) : (
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <ImageOff className="size-4" />
        </span>
      )}
      <div className="min-w-0">
        <Link to={to} className="type-body block truncate font-medium text-foreground transition-colors hover:text-primary focus-visible:underline focus-visible:outline-none">
          {issue.title}
        </Link>
        <p className="type-caption truncate">
          {issue.reference_number}
          {issue.address ? ` · ${issue.address}` : ''}
        </p>
      </div>
    </div>
  )
}

/** A category as a colour dot + name (the dot colour is the map pin colour for that category). */
export function CategoryTag({ issue }: { issue: Issue }) {
  return (
    <span className="type-body inline-flex items-center gap-2 text-muted-foreground">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colorForCategory(issue.category.id) }} />
      {issue.category.name}
    </span>
  )
}

/** "Showing 21–40 of 87" on the left, Previous / Next on the right. */
export function ListFooter({ page, total, shown, onPageChange }: { page: number; total: number; shown: number; onPageChange: (page: number) => void }) {
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="type-caption tabular" aria-live="polite">
        {total === 0 ? 'No results' : `Showing ${first}–${first + shown - 1} of ${total}`}
      </p>
      <Pagination page={page} pageCount={pageCount} onPageChange={onPageChange} />
    </div>
  )
}

/** One row in a "needs attention" list: priority icon, title, context, status, chevron. */
export function AttentionRow({ issue, to, context, showStatus = false }: { issue: Issue; to: string; context: ReactNode; showStatus?: boolean }) {
  const Priority = PRIORITY_META[issue.priority].icon
  return (
    <li>
      <Link
        to={to}
        className="group flex items-center gap-4 px-6 py-4 transition-colors duration-150 hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
      >
        <span data-tone={issue.priority} className="tone-chip flex size-8 shrink-0 items-center justify-center rounded-md border" title={`${PRIORITY_META[issue.priority].label} priority`}>
          <Priority aria-hidden className="size-4" />
          <span className="sr-only">{PRIORITY_META[issue.priority].label} priority</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="type-body truncate font-medium text-foreground">{issue.title}</p>
          <p className="type-caption truncate">{context}</p>
        </div>
        {showStatus && <StatusBadge status={issue.status} className="hidden sm:inline-flex" />}
        <ChevronRight aria-hidden className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5')} />
      </Link>
    </li>
  )
}

export { PriorityBadge }

/** "Reported 3 days ago" for table cells. */
export function Age({ iso }: { iso: string }) {
  return (
    <span className="type-body whitespace-nowrap text-muted-foreground" title={new Date(iso).toLocaleString()}>
      {formatRelative(iso)}
    </span>
  )
}

const MODERATION = {
  pending: { label: 'Awaiting review', icon: Clock, tone: 'warning' },
  approved: { label: 'Approved', icon: ShieldCheck, tone: 'success' },
  rejected: { label: 'Rejected', icon: Ban, tone: 'danger' },
} as const

/** Moderation state (is the issue allowed to be public?), distinct from its lifecycle status. */
export function ModerationBadge({ status }: { status: ModerationStatus }) {
  const meta = MODERATION[status]
  const Icon = meta.icon
  return (
    <span data-tone={meta.tone} className="tone-chip inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap">
      <Icon aria-hidden className="size-3.5" />
      {meta.label}
    </span>
  )
}
