import { Building2, Pencil, Plus, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'

import { Avatar } from '@/components/Avatar'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { DepartmentDialog } from '@/features/staff/DepartmentDialog'
import { useAdminAnalytics, useDeleteDepartment, useDepartments } from '@/features/staff/hooks'
import { OfficerDialog } from '@/features/staff/OfficerDialog'
import { getApiErrorMessage } from '@/services/apiClient'
import type { Department } from '@/types/staff'
import { formatHours } from '@/utils/format'

function OfficerStack({ department }: { department: Department }) {
  const shown = department.officers.slice(0, 3)
  const more = department.officers.length - shown.length
  if (department.officers.length === 0) return <span className="text-muted-foreground">None yet</span>
  return (
    <div className="flex items-center gap-2" title={department.officers.map((o) => o.name).join(', ')}>
      <span className="flex -space-x-1">
        {shown.map((o) => (
          <Avatar key={o.id} name={o.name} size="sm" className="ring-2 ring-surface" />
        ))}
      </span>
      <span className="type-body text-muted-foreground">
        {department.officers.length} {department.officers.length === 1 ? 'officer' : 'officers'}
        {more > 0 ? '' : ''}
      </span>
    </div>
  )
}

export function AdminDepartmentsPage() {
  const departments = useDepartments()
  const analytics = useAdminAnalytics(90)
  const remove = useDeleteDepartment()
  const [editing, setEditing] = useState<Department | null>(null)
  const [creating, setCreating] = useState(false)
  const [addingOfficer, setAddingOfficer] = useState<{ open: boolean; departmentId?: string }>({ open: false })
  const [deleting, setDeleting] = useState<Department | null>(null)

  const stats = new Map((analytics.data?.departments ?? []).map((d) => [d.id, d]))

  const columns: Column<Department>[] = [
    {
      id: 'name',
      header: 'Department',
      cell: (d) => (
        <div className="min-w-0 leading-tight">
          <p className="type-body truncate font-medium">{d.name}</p>
          <p className="type-caption max-w-[320px] truncate">{d.description || d.city || '—'}</p>
        </div>
      ),
    },
    { id: 'city', header: 'City', hideBelow: 'md', cell: (d) => <span className="text-muted-foreground">{d.city || '—'}</span> },
    { id: 'officers', header: 'Officers', cell: (d) => <OfficerStack department={d} /> },
    { id: 'queue', header: 'In queue', align: 'right', hideBelow: 'md', cell: (d) => stats.get(d.id)?.in_queue ?? 0 },
    { id: 'resolved', header: 'Resolved', align: 'right', hideBelow: 'lg', cell: (d) => stats.get(d.id)?.resolved ?? 0 },
    { id: 'avg', header: 'Avg. time', align: 'right', hideBelow: 'lg', cell: (d) => formatHours(stats.get(d.id)?.avg_resolution_hours) },
    {
      id: 'status',
      header: 'Status',
      cell: (d) => (
        <span data-tone={d.is_active ? 'success' : 'neutral'} className="tone-chip inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium">
          <span aria-hidden className="tone-dot size-1.5 rounded-full" />
          {d.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (d) => (
        // these buttons sit inside a clickable row: stop the click so the row does not ALSO open the editor
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" aria-label={`Add officer to ${d.name}`} title="Add officer" onClick={() => setAddingOfficer({ open: true, departmentId: d.id })}>
            <UserPlus aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Edit ${d.name}`} title="Edit" onClick={() => setEditing(d)}>
            <Pencil aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Delete ${d.name}`} title="Delete" onClick={() => setDeleting(d)} className="hover:text-destructive">
            <Trash2 aria-hidden />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Departments"
        description="The teams that fix things. Add departments, put officers in them, and switch a department off when it should stop receiving issues."
        actions={
          <>
            <Button variant="outline" onClick={() => setAddingOfficer({ open: true })}>
              <UserPlus aria-hidden />
              Add officer
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              New department
            </Button>
          </>
        }
      />

      {departments.isError ? (
        <ErrorState message={getApiErrorMessage(departments.error)} onRetry={() => departments.refetch()} />
      ) : (
        <DataTable
          label="Departments"
          columns={columns}
          rows={departments.data ?? []}
          rowKey={(d) => d.id}
          loading={departments.isPending}
          onRowClick={(d) => setEditing(d)}
          empty={
            <EmptyState
              icon={Building2}
              title="No departments yet"
              description="Create the first department, then add officers to it."
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus aria-hidden />
                  New department
                </Button>
              }
            />
          }
        />
      )}

      <DepartmentDialog open={creating} onOpenChange={setCreating} />
      <DepartmentDialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} department={editing} />
      <OfficerDialog open={addingOfficer.open} onOpenChange={(open) => setAddingOfficer({ open })} departments={departments.data ?? []} departmentId={addingOfficer.departmentId} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'department'}?`}
        description="A department with officers or assignment history cannot be deleted; switch it to inactive instead. This cannot be undone."
        confirmLabel="Delete department"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </div>
  )
}
