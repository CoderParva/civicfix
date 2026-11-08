import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

const schema = z.object({
  reason: z.string().trim().min(3, 'Give a short reason (at least 3 characters)').max(255, 'Keep it under 255 characters'),
})
type Values = z.infer<typeof schema>

interface ReasonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  label?: string
  placeholder?: string
  confirmLabel: string
  /** destructive = red confirm button (rejecting, hiding); primary otherwise. */
  tone?: 'destructive' | 'primary'
  /** Resolve when the action succeeded; throw to keep the dialog open (the hook already toasts the error). */
  onConfirm: (reason: string) => Promise<unknown>
}

/** A confirmation that insists on a written reason: the backend requires one, and the history keeps it. */
export function ReasonDialog({ open, onOpenChange, title, description, label = 'Reason', placeholder, confirmLabel, tone = 'primary', onConfirm }: ReasonDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { reason: '' } })

  const submit = handleSubmit(async ({ reason }) => {
    try {
      await onConfirm(reason)
      onOpenChange(false)
      reset()
    } catch {
      /* the mutation hook already showed the server's message; stay open so the text is not lost */
    }
  })

  return (
    <Dialog open={open} onOpenChange={(next) => (onOpenChange(next), !next && reset())}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <FormField id="reason" label={label} error={errors.reason?.message}>
            <Textarea id="reason" aria-invalid={!!errors.reason} placeholder={placeholder} autoFocus {...register('reason')} />
          </FormField>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={tone === 'destructive' ? 'destructive' : 'default'} disabled={isSubmitting}>
              {isSubmitting ? 'Working…' : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
