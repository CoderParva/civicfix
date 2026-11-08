import axios from 'axios'
import { CheckCircle2, CornerUpLeft, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Avatar } from '@/components/Avatar'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Button, buttonVariants } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { PriorityBadge } from '@/features/issues/components/PriorityBadge'
import { StatusBadge } from '@/features/issues/components/StatusBadge'
import { useAcceptIssue, useOfficerIssue, useRejectAssignment, useResolveIssue } from '@/features/staff/hooks'
import { Facts, IssueDescription, IssueLocation, IssuePhotos } from '@/features/staff/IssueBody'
import { CategoryTag } from '@/features/staff/IssueParts'
import { LifecycleStepper } from '@/features/staff/LifecycleStepper'
import { NotesPanel } from '@/features/staff/NotesPanel'
import { planOfficerActions } from '@/features/staff/officerActions'
import { ReasonDialog } from '@/features/staff/ReasonDialog'
import { ResolveDialog } from '@/features/staff/ResolveDialog'
import { StatusTimeline } from '@/features/staff/StatusTimeline'
import { getApiErrorMessage } from '@/services/apiClient'
import type { OfficerIssue } from '@/types/staff'
import { cn } from '@/utils/cn'
import { formatDateTime, formatRelative } from '@/utils/format'

function ActionsPanel({ issue }: { issue: OfficerIssue }) {
  const accept = useAcceptIssue()
  const reject = useRejectAssignment()
  const resolve = useResolveIssue()
  const navigate = useNavigate()
  const [rejecting, setRejecting] = useState(false)
  const [resolving, setResolving] = useState(false)
  const plan = planOfficerActions(issue)

  return (
    <Panel aria-label="Actions">
      <PanelHeader title="Actions" />
      <PanelBody className="flex flex-col gap-4 pt-4">
        {plan.kind === 'accept' && (
          <>
            <p className="type-body text-muted-foreground">This issue was assigned to you. Accept it to start work, or send it back if it does not belong to your department.</p>
            <Button size="lg" onClick={() => accept.mutate(issue.id)} disabled={accept.isPending}>
              <CheckCircle2 aria-hidden />
              {accept.isPending ? 'Accepting…' : 'Accept assignment'}
            </Button>
            <Button variant="outline" size="lg" onClick={() => setRejecting(true)}>
              <CornerUpLeft aria-hidden />
              Send back…
            </Button>
          </>
        )}
        {plan.kind === 'resolve' && (
          <>
            <p className="type-body text-muted-foreground">Work is underway. When it is finished, attach a photo of the result and mark it resolved.</p>
            <Button size="lg" onClick={() => setResolving(true)}>
              <ShieldCheck aria-hidden />
              Mark as resolved…
            </Button>
          </>
        )}
        {plan.kind === 'none' && <p className="type-body text-muted-foreground">{plan.message}</p>}
      </PanelBody>

      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Send back to the admin"
        description="Explain why this does not belong to your department. The admin sees your reason and will reassign it."
        placeholder="e.g. This is a drainage issue, not a road repair"
        confirmLabel="Send back"
        tone="destructive"
        // once sent back it is no longer in this officer's queue, so go back to the queue instead of a 403 page
        onConfirm={async (reason) => {
          await reject.mutateAsync({ id: issue.id, reason })
          navigate('/officer/issues')
        }}
      />
      <ResolveDialog open={resolving} onOpenChange={setResolving} issue={issue} onConfirm={({ image, remarks }) => resolve.mutateAsync({ id: issue.id, image, remarks })} />
    </Panel>
  )
}

function AssignmentPanel({ issue }: { issue: OfficerIssue }) {
  const assignment = issue.assignment
  return (
    <Panel aria-label="Assignment">
      <PanelHeader title="Assignment" />
      <PanelBody className="flex flex-col gap-6 pt-4">
        {assignment ? (
          <>
            <div className="flex items-center gap-4">
              <Avatar name={assignment.officer.name} />
              <div className="min-w-0">
                <p className="type-body truncate font-medium">
                  {assignment.officer.name}
                  {assignment.is_mine && <span className="type-caption ml-2 rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground">You</span>}
                </p>
                <p className="type-caption">
                  {assignment.officer.employee_reference} · {assignment.department.name}
                </p>
              </div>
            </div>
            <Facts
              rows={[
                { label: 'Assigned', value: <time title={formatDateTime(assignment.assigned_at)}>{formatRelative(assignment.assigned_at)}</time> },
                { label: 'Accepted', value: assignment.accepted_at ? <time title={formatDateTime(assignment.accepted_at)}>{formatRelative(assignment.accepted_at)}</time> : 'Not yet' },
              ]}
            />
          </>
        ) : (
          <p className="type-body text-muted-foreground">Not assigned to your department any more.</p>
        )}
      </PanelBody>
    </Panel>
  )
}

export function OfficerIssuePage() {
  const { id } = useParams()
  const issue = useOfficerIssue(id)

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
    const forbidden = axios.isAxiosError(issue.error) && [403, 404].includes(issue.error.response?.status ?? 0)
    return forbidden ? (
      <Panel>
        <EmptyState
          title="Not in your queue"
          description="This issue is not assigned to your department, or it does not exist."
          action={<Link to="/officer/issues" className={cn(buttonVariants())}>Back to my queue</Link>}
        />
      </Panel>
    ) : (
      <ErrorState message={getApiErrorMessage(issue.error)} onRetry={() => issue.refetch()} />
    )
  }

  const data = issue.data
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        breadcrumbs={[{ label: 'My queue', to: '/officer/issues' }, { label: data.reference_number }]}
        title={data.title}
        meta={
          <>
            <StatusBadge status={data.status} />
            <PriorityBadge priority={data.priority} compact />
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
            <PanelHeader title="Activity" description="Every status change: who made it, why, and how long it took" />
            <PanelBody className="pt-6">
              <StatusTimeline history={data.status_history ?? []} />
            </PanelBody>
          </Panel>
          <IssuePhotos issue={data} />
          <IssueLocation issue={data} />
          <NotesPanel issueId={data.id} />
        </div>
        <div className="flex flex-col gap-6 lg:sticky lg:top-8">
          <ActionsPanel issue={data} />
          <AssignmentPanel issue={data} />
          <Panel aria-label="Details">
            <PanelHeader title="Details" />
            <PanelBody className="pt-4">
              <Facts
                rows={[
                  { label: 'Reference', value: data.reference_number },
                  { label: 'Reported', value: formatDateTime(data.created_at) },
                  { label: 'Votes', value: data.vote_count },
                  { label: 'Comments', value: data.comment_count },
                ]}
              />
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  )
}
