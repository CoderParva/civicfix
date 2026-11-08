import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  tone?: 'destructive' | 'primary'
  /** Resolve on success; throw to keep the dialog open. */
  onConfirm: () => Promise<unknown>
}

/** A yes/no for actions that cannot be undone. The destructive button is red, Cancel is the quiet one. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, tone = 'destructive', onConfirm }: ConfirmDialogProps) {
  const [pending, setPending] = useState(false)
  async function confirm() {
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch {
      /* the mutation hook already toasted the server's message */
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={tone === 'destructive' ? 'destructive' : 'default'} onClick={confirm} disabled={pending}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
