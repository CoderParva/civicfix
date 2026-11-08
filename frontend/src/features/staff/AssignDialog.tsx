import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import type { Department } from '@/types/staff'

import { useDepartments } from './hooks'

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive'

interface AssignDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-select the department that fits the issue's category, if known. */
  suggestedDepartmentId?: string
  onConfirm: (input: { department: string; officer: string }) => Promise<unknown>
}

/** Two-step picker: department first, then one of *its* officers (an officer from another department would be refused). */
export function AssignDialog({ open, onOpenChange, suggestedDepartmentId, onConfirm }: AssignDialogProps) {
  const departments = useDepartments()
  const [departmentId, setDepartmentId] = useState('')
  const [officerId, setOfficerId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const active: Department[] = (departments.data ?? []).filter((d) => d.is_active && d.officers.length > 0)
  const department = active.find((d) => d.id === (departmentId || suggestedDepartmentId))
  const selectedDepartment = department?.id ?? ''

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setDepartmentId('')
      setOfficerId('')
      setError(null)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedDepartment || !officerId) {
      setError(!selectedDepartment ? 'Choose a department.' : 'Choose an officer.')
      return
    }
    setError(null)
    setPending(true)
    try {
      await onConfirm({ department: selectedDepartment, officer: officerId })
      close(false)
    } catch {
      /* toasted by the hook */
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Assign to a department</DialogTitle>
            <DialogDescription>Pick the department, then the officer who should own it. They will see it in their queue straight away.</DialogDescription>
          </DialogHeader>

          {departments.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="assign-department">Department</Label>
                <select
                  id="assign-department"
                  className={SELECT_CLASS}
                  value={selectedDepartment}
                  onChange={(e) => {
                    setDepartmentId(e.target.value)
                    setOfficerId('')
                  }}
                >
                  <option value="">Select a department</option>
                  {active.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.officers.length} {d.officers.length === 1 ? 'officer' : 'officers'})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="assign-officer">Officer</Label>
                <select id="assign-officer" className={SELECT_CLASS} value={officerId} disabled={!department} onChange={(e) => setOfficerId(e.target.value)}>
                  <option value="">{department ? 'Select an officer' : 'Choose a department first'}</option>
                  {department?.officers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} · {o.employee_reference}
                    </option>
                  ))}
                </select>
              </div>
              {error && (
                <p role="alert" className="type-caption text-destructive">
                  {error}
                </p>
              )}
            </>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || departments.isPending}>
              {pending ? 'Assigning…' : 'Assign'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
