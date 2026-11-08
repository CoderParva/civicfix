import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getFieldErrors } from '@/services/apiClient'
import type { Department } from '@/types/staff'

import { useCreateOfficer } from './hooks'
import { officerSchema, type OfficerValues } from './schemas'

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive'
const FIELDS = ['full_name', 'email', 'password', 'department', 'employee_reference'] as const

interface OfficerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  departments: Department[]
  /** Pre-select a department (e.g. from the row you clicked "Add officer" on). */
  departmentId?: string
}

/** Creates the officer's account and profile in one step (POST /admin/officers/). The role is never an input. */
export function OfficerDialog({ open, onOpenChange, departments, departmentId }: OfficerDialogProps) {
  const create = useCreateOfficer()
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OfficerValues>({ resolver: zodResolver(officerSchema), defaultValues: { full_name: '', email: '', password: '', department: departmentId ?? '', employee_reference: '' } })

  useEffect(() => {
    if (open) reset({ full_name: '', email: '', password: '', department: departmentId ?? '', employee_reference: '' })
  }, [open, departmentId, reset])

  const submit = handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values)
      onOpenChange(false)
    } catch (error) {
      // duplicate email / weak password / duplicate employee reference come back per field
      const fields = getFieldErrors(error)
      for (const key of FIELDS) if (fields[key]) setError(key, { message: fields[key] })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Add an officer</DialogTitle>
            <DialogDescription>Creates their account and puts them in a department. They can sign in straight away with this email and password.</DialogDescription>
          </DialogHeader>
          <FormField id="off-name" label="Full name" error={errors.full_name?.message}>
            <Input id="off-name" autoComplete="off" aria-invalid={!!errors.full_name} autoFocus {...register('full_name')} />
          </FormField>
          <FormField id="off-email" label="Email" error={errors.email?.message}>
            <Input id="off-email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...register('email')} />
          </FormField>
          <FormField id="off-password" label="Temporary password" error={errors.password?.message} hint="At least 8 characters. Share it securely; they can change it later.">
            <Input id="off-password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register('password')} />
          </FormField>
          <div className="grid gap-6 sm:grid-cols-2">
            <FormField id="off-department" label="Department" error={errors.department?.message}>
              <select id="off-department" className={SELECT_CLASS} aria-invalid={!!errors.department} {...register('department')}>
                <option value="">Select a department</option>
                {departments
                  .filter((d) => d.is_active)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </FormField>
            <FormField id="off-ref" label="Employee reference" error={errors.employee_reference?.message}>
              <Input id="off-ref" placeholder="e.g. PW-104" aria-invalid={!!errors.employee_reference} {...register('employee_reference')} />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create officer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
