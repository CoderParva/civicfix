import { Lock, Send } from 'lucide-react'
import { useState } from 'react'

import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatRelative } from '@/utils/format'

import { useAddNote, useOfficerNotes } from './hooks'

/** Private notes for the department. Citizens never see these: the API has no public path to them. */
export function NotesPanel({ issueId }: { issueId: string }) {
  const notes = useOfficerNotes(issueId)
  const addNote = useAddNote()
  const [text, setText] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const note = text.trim()
    if (!note) return
    try {
      await addNote.mutateAsync({ id: issueId, note })
      setText('')
    } catch {
      /* toasted by the hook; keep the text */
    }
  }

  return (
    <Panel aria-label="Internal notes">
      <PanelHeader
        title="Internal notes"
        description={
          <span className="inline-flex items-center gap-1">
            <Lock aria-hidden className="size-3" /> Only your department can see these.
          </span>
        }
      />
      <PanelBody className="flex flex-col gap-6">
        {notes.isPending && <Skeleton className="h-16 w-full" />}
        {notes.isSuccess && notes.data.length === 0 && <p className="type-body text-muted-foreground">No notes yet. Use them to log site visits, blockers and hand-offs.</p>}
        {notes.isSuccess && notes.data.length > 0 && (
          <ul className="flex flex-col gap-4">
            {notes.data.map((note) => (
              <li key={note.id} className="flex gap-4">
                <Avatar name={note.author_name} />
                <div className="min-w-0 flex-1">
                  <p className="type-body">
                    <span className="font-medium">{note.author_name}</span> <span className="text-muted-foreground">· {formatRelative(note.created_at)}</span>
                  </p>
                  <p className="type-body mt-1 whitespace-pre-line text-foreground/90">{note.note}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Textarea aria-label="New note" placeholder="Add a note for your colleagues…" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} className="min-h-20" />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!text.trim() || addNote.isPending}>
              <Send aria-hidden />
              Add note
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  )
}
