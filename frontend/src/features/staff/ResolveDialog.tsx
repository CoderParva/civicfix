import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { PhotoDropzone } from '@/features/issues/components/PhotoDropzone'
import type { OfficerIssue } from '@/types/staff'

interface ResolveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  issue: OfficerIssue
  onConfirm: (input: { image: File | null; remarks: string }) => Promise<unknown>
}

/** Resolving needs evidence: a photo of the finished work (unless one was already uploaded). */
export function ResolveDialog({ open, onOpenChange, issue, onConfirm }: ResolveDialogProps) {
  const [files, setFiles] = useState<File[]>([])
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const hasEvidence = issue.images.some((i) => i.image_type === 'resolution')

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setFiles([])
      setRemarks('')
      setError(null)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!hasEvidence && files.length === 0) {
      setError('Add a photo that shows the finished work.')
      return
    }
    setError(null)
    setPending(true)
    try {
      await onConfirm({ image: files[0] ?? null, remarks: remarks.trim() })
      close(false)
    } catch {
      /* already toasted by the hook; keep the dialog (and the chosen photo) */
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Mark as resolved</DialogTitle>
            <DialogDescription>
              Residents will see this photo as proof of the fix. Add a short note about what was done.
            </DialogDescription>
          </DialogHeader>

          {hasEvidence ? (
            <p role="status" className="type-body rounded-md border bg-subtle p-4 text-muted-foreground">
              A resolution photo is already attached to this issue. You can add another below, or just confirm.
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label>Photo of the finished work {hasEvidence ? '(optional)' : ''}</Label>
            <PhotoDropzone
              files={files}
              onChange={(next) => {
                setFiles(next)
                if (next.length > 0) setError(null) // the complaint is about a missing photo: clear it once there is one
              }}
              max={1}
            />
            {error && (
              <p role="alert" className="type-caption text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="remarks">What was done (optional)</Label>
            <Textarea id="remarks" maxLength={255} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Filled and levelled with cold-mix asphalt" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Resolving…' : 'Mark as resolved'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
