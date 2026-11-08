import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import { FormField } from '@/components/FormField'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { getApiErrorMessage, getFieldErrors } from '@/services/apiClient'
import type { Department } from '@/types/staff'

import { useCreateDepartment, useUpdateDepartment } from './hooks'
import { departmentSchema, type DepartmentValues } from './schemas'

const EMPTY: DepartmentValues = { name: '', city: 'Indore', description: '', is_active: true }

interface DepartmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present = edit this department; absent = create a new one. */
  department?: Department | null
}

export function DepartmentDialog({ open, onOpenChange, department }: DepartmentDialogProps) {
  const create = useCreateDepartment()
  const update = useUpdateDepartment()
  const editing = !!department
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DepartmentValues>({ resolver: zodResolver(departmentSchema), defaultValues: EMPTY })

  useEffect(() => {
    if (open) reset(department ? { name: department.name, city: department.city, description: department.description, is_active: department.is_active } : EMPTY)
  }, [open, department, reset])

  const submit = handleSubmit(async (values) => {
    try {
      if (department) await update.mutateAsync({ id: department.id, ...values })
      else await create.mutateAsync(values)
      onOpenChange(false)
    } catch (error) {
      // the hook toasts the message; also put field errors (e.g. duplicate name) on the right input
      const fields = getFieldErrors(error)
      for (const key of ['name', 'city', 'description'] as const) if (fields[key]) setError(key, { message: fields[key] })
      void getApiErrorMessage(error)
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit department' : 'New department'}</DialogTitle>
            <DialogDescription>{editing ? 'Change how this department appears and whether it can receive new issues.' : 'Departments receive issues and own their officers.'}</DialogDescription>
          </DialogHeader>
          {errors.root && <Alert variant="destructive">{errors.root.message}</Alert>}
          <FormField id="dept-name" label="Name" error={errors.name?.message}>
            <Input id="dept-name" aria-invalid={!!errors.name} placeholder="e.g. Public Works" autoFocus {...register('name')} />
          </FormField>
          <FormField id="dept-city" label="City" error={errors.city?.message}>
            <Input id="dept-city" aria-invalid={!!errors.city} {...register('city')} />
          </FormField>
          <FormField id="dept-description" label="Description" error={errors.description?.message}>
            <Textarea id="dept-description" aria-invalid={!!errors.description} placeholder="What does this department look after?" className="min-h-20" {...register('description')} />
          </FormField>
          <label className="type-body flex items-center gap-2">
            <input type="checkbox" className="size-4 rounded-sm accent-[var(--primary)]" {...register('is_active')} />
            Active (can be assigned new issues)
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Create department'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
