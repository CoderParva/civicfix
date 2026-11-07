import { Link } from 'react-router-dom'

import { Card } from '@/components/ui/card'
import type { Issue } from '@/types/api'
import { formatDate } from '@/utils/format'

import { PriorityBadge } from './PriorityBadge'
import { StatusBadge } from './StatusBadge'

/** Where the issue is: the address if there is one, otherwise the raw coordinates. */
export function locationLabel(issue: Issue): string {
  if (issue.address) return issue.address
  return `${issue.location.latitude.toFixed(4)}, ${issue.location.longitude.toFixed(4)}`
}

export function IssueCard({ issue }: { issue: Issue }) {
  const photo = issue.images.find((i) => i.image_type === 'report') ?? issue.images[0]
  return (
    <Card className="flex-row gap-4 p-4" data-testid="issue-card">
      {photo ? (
        <img src={photo.url} alt="" className="size-20 shrink-0 rounded-md object-cover" loading="lazy" />
      ) : (
        <div
          aria-hidden
          className="flex size-20 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground"
        >
          No photo
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate font-semibold">
            <Link to={`/issues/${issue.id}`} className="underline-offset-4 hover:underline">
              {issue.title}
            </Link>
          </h3>
          <StatusBadge status={issue.status} />
          <PriorityBadge priority={issue.priority} />
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground">{issue.description}</p>
        <p className="text-xs text-muted-foreground">
          {issue.reference_number} · {issue.category.name} · {formatDate(issue.created_at)}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span>{locationLabel(issue)}</span>
          <span aria-label={`${issue.vote_count} ${issue.vote_count === 1 ? 'vote' : 'votes'}`}>▲ {issue.vote_count}</span>
        </p>
        {issue.moderation_status === 'pending' && (
          <p className="text-xs font-medium text-amber-700">Awaiting review before it becomes public</p>
        )}
        {issue.moderation_status === 'rejected' && (
          <p className="text-xs font-medium text-rose-700">Not approved for public listing</p>
        )}
      </div>
    </Card>
  )
}
