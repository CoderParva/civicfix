import axios from 'axios'
import { Ban, Check, EyeOff, Flag, RotateCcw, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Avatar } from '@/components/Avatar'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Button, buttonVariants } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { PriorityBadge } from '@/features/issues/components/PriorityBadge'
import { StatusBadge } from '@/features/issues/components/StatusBadge'
import { planAdminActions } from '@/features/staff/adminActions'
import { AssignDialog } from '@/features/staff/AssignDialog'
import {
  useAdminIssue,
  useApproveIssue,
  useAssignIssue,
  useHideComment,
  useIssueComments,
  useReopenIssue,
  useRejectIssue,
} from '@/features/staff/hooks'
import { Facts, IssueDescription, IssueLocation, IssuePhotos } from '@/features/staff/IssueBody'
import { CategoryTag, ModerationBadge } from '@/features/staff/IssueParts'
import { LifecycleStepper } from '@/features/staff/LifecycleStepper'
import { ReasonDialog } from '@/features/staff/ReasonDialog'
import { StatusTimeline } from '@/features/staff/StatusTimeline'
import { getApiErrorMessage } from '@/services/apiClient'
import type { IssueComment } from '@/types/api'
import type { AdminIssue } from '@/types/staff'
import { cn } from '@/utils/cn'
import { formatDateTime, formatRelative } from '@/utils/format'

function ModerationPanel({ issue }: { issue: AdminIssue }) {
  const approve = useApproveIssue()
  const reject = useRejectIssue()
  const reopen = useReopenIssue()
  const assign = useAssignIssue()
  const [rejecting, setRejecting] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const plan = planAdminActions(issue)
  const assignment = issue.assignment

  return (
    <>
      <Panel aria-label="Moderation">
        <PanelHeader title="Moderation" actions={<ModerationBadge status={issue.moderation_status} />} />
        <PanelBody className="flex flex-col gap-4 pt-4">
          {issue.report_count > 0 && (
            <p data-tone="danger" className="tone-chip type-body flex items-center gap-2 rounded-md border p-4">
              <Flag aria-hidden className="size-4 shrink-0" />
              Flagged by {issue.report_count} {issue.report_count === 1 ? 'resident' : 'residents'}
            </p>
          )}
          {plan.approve && (
            <Button size="lg" onClick={() => approve.mutate(issue.id)} disabled={approve.isPending}>
              <Check aria-hidden />
              {approve.isPending ? 'Approving…' : 'Approve and start review'}
            </Button>
          )}
          {plan.assign && (
            <Button size="lg" onClick={() => setAssigning(true)}>
              <UserPlus aria-hidden />
              {assignment ? 'Reassign…' : 'Assign to a department…'}
            </Button>
          )}
          {plan.reopen && (
            <Button size="lg" onClick={() => setReopening(true)}>
              <RotateCcw aria-hidden />
              Reopen…
            </Button>
          )}
          {plan.reject && (
            <Button variant="outline" size="lg" onClick={() => setRejecting(true)} className="text-destructive hover:text-destructive">
              <Ban aria-hidden />
              Reject…
            </Button>
          )}
          {plan.note && <p className="type-body text-muted-foreground">{plan.note}</p>}
        </PanelBody>
      </Panel>

      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Reject this issue"
        description="The reporter will no longer see it publicly, and the reason is kept in its history. This cannot be undone."
        placeholder="e.g. Duplicate of an existing report"
        confirmLabel="Reject issue"
        tone="destructive"
        onConfirm={(reason) => reject.mutateAsync({ id: issue.id, reason })}
      />
      <ReasonDialog
        open={reopening}
        onOpenChange={setReopening}
        title="Reopen this issue"
        description="Send it back for review because the fix did not hold. The reason goes into the history."
        placeholder="e.g. The pothole is back after the rain"
        confirmLabel="Reopen issue"
        onConfirm={(reason) => reopen.mutateAsync({ id: issue.id, reason })}
      />
      <AssignDialog open={assigning} onOpenChange={setAssigning} onConfirm={({ department, officer }) => assign.mutateAsync({ id: issue.id, department, officer })} />
    </>
  )
}

function AssignmentPanel({ issue }: { issue: AdminIssue }) {
  const a = issue.assignment
  return (
    <Panel aria-label="Assignment">
      <PanelHeader title="Assignment" />
      <PanelBody className="flex flex-col gap-6 pt-4">
        {a ? (
          <>
            <div className="flex items-center gap-4">
              <Avatar name={a.officer.name} />
              <div className="min-w-0">
                <p className="type-body truncate font-medium">{a.officer.name}</p>
                <p className="type-caption">
                  {a.officer.employee_reference} · {a.department.name}
                </p>
              </div>
            </div>
            <Facts
              rows={[
                { label: 'Assigned', value: <time title={formatDateTime(a.assigned_at)}>{formatRelative(a.assigned_at)}</time> },
                { label: 'Accepted', value: a.accepted_at ? <time title={formatDateTime(a.accepted_at)}>{formatRelative(a.accepted_at)}</time> : 'Not yet' },
              ]}
            />
          </>
        ) : (
          <p className="type-body text-muted-foreground">Not assigned to a department yet.</p>
        )}
      </PanelBody>
    </Panel>
  )
}

function CommentsPanel({ issue }: { issue: AdminIssue }) {
  const comments = useIssueComments(issue.id)
  const hide = useHideComment()
  const [target, setTarget] = useState<IssueComment | null>(null)
  const notPublic = comments.isError && axios.isAxiosError(comments.error) && comments.error.response?.status === 404

  return (
    <Panel aria-label="Comments">
      <PanelHeader title="Comments" description="What residents are saying publicly. Hiding a comment removes it from public view." />
      <PanelBody className="pt-4">
        {comments.isPending && <Skeleton className="h-16 w-full" />}
        {notPublic && <p className="type-body text-muted-foreground">Comments open once the issue is public.</p>}
        {comments.isError && !notPublic && <ErrorState message={getApiErrorMessage(comments.error)} onRetry={() => comments.refetch()} />}
        {comments.isSuccess && comments.data.length === 0 && <p className="type-body text-muted-foreground">No visible comments.</p>}
        {comments.isSuccess && comments.data.length > 0 && (
          <ul className="flex flex-col divide-y">
            {comments.data.map((comment) => (
              <li key={comment.id} className="group flex items-start gap-4 py-4 first:pt-0 last:pb-0">
                <Avatar name={comment.author_name} />
                <div className="min-w-0 flex-1">
                  <p className="type-body">
                    <span className="font-medium">{comment.author_name}</span> <span className="text-muted-foreground">· {formatRelative(comment.created_at)}</span>
                  </p>
                  <p className="type-body mt-1 whitespace-pre-line text-foreground/90">{comment.content}</p>
                </div>
                <Button variant="ghost" size="sm" aria-label={`Hide comment by ${comment.author_name}`} onClick={() => setTarget(comment)} className="text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100">
                  <EyeOff aria-hidden />
                  Hide
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Hide this comment?"
        description={target ? `“${target.content.slice(0, 120)}” by ${target.author_name} will no longer be visible to the public.` : ''}
        confirmLabel="Hide comment"
        onConfirm={() => hide.mutateAsync(target!.id)}
      />
    </Panel>
  )
}

export function AdminIssuePage() {
  const { id } = useParams()
  const issue = useAdminIssue(id)

  if (issue.isPending) {
    return (
      <div role="status" aria-label="Loading issue" className="flex flex-col gap-6">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-96 rounded-xl lg:col-span-2" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    )
  }
  if (issue.isError) {
    const missing = axios.isAxiosError(issue.error) && issue.error.response?.status === 404
    return missing ? (
      <Panel>
        <EmptyState title="Issue not found" description="It may have been removed." action={<Link to="/admin/issues" className={cn(buttonVariants())}>Back to issues</Link>} />
      </Panel>
    ) : (
      <ErrorState message={getApiErrorMessage(issue.error)} onRetry={() => issue.refetch()} />
    )
  }

  const data = issue.data
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        breadcrumbs={[{ label: 'Issues', to: '/admin/issues' }, { label: data.reference_number }]}
        title={data.title}
        meta={
          <>
            <StatusBadge status={data.status} />
            <PriorityBadge priority={data.priority} compact />
            <ModerationBadge status={data.moderation_status} />
            <CategoryTag issue={data} />
            <span className="type-caption">Reported {formatRelative(data.created_at)}</span>
          </>
        }
      />

      <Panel aria-label="Progress" className="px-6 py-6">
        <LifecycleStepper status={data.status} />
      </Panel>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <IssueDescription issue={data} />
          <Panel aria-label="Activity">
            <PanelHeader title="Activity" description="The complete audit trail: every status change, who made it and why" />
            <PanelBody className="pt-6">
              <StatusTimeline history={data.status_history ?? []} />
            </PanelBody>
          </Panel>
          <IssuePhotos issue={data} />
          <IssueLocation issue={data} />
          <CommentsPanel issue={data} />
        </div>
        <div className="flex flex-col gap-6 lg:sticky lg:top-8">
          <ModerationPanel issue={data} />
          <AssignmentPanel issue={data} />
          <Panel aria-label="Reporter">
            <PanelHeader title="Reporter" />
            <PanelBody className="flex items-center gap-4 pt-4">
              <Avatar name={data.reporter.full_name} />
              <div className="min-w-0">
                <p className="type-body truncate font-medium">{data.reporter.full_name}</p>
                <p className="type-caption truncate">{data.reporter.email}</p>
              </div>
            </PanelBody>
          </Panel>
          <Panel aria-label="Details">
            <PanelHeader title="Details" />
            <PanelBody className="pt-4">
              <Facts
                rows={[
                  { label: 'Reference', value: data.reference_number },
                  { label: 'Reported', value: formatDateTime(data.created_at) },
                  { label: 'Votes', value: data.vote_count },
                  { label: 'Comments', value: data.comment_count },
                  { label: 'Flags', value: data.report_count },
                ]}
              />
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  )
}
