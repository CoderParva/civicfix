import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'

import { MAX_PHOTOS, validatePhoto } from '../schemas'

interface PhotoDropzoneProps {
  files: File[]
  onChange: (files: File[]) => void
}

/** Drag-and-drop (or click) photo picker with previews. Validates type/size like the server does. */
export function PhotoDropzone({ files, onChange }: PhotoDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [problems, setProblems] = useState<string[]>([])

  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files])
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews])

  function addFiles(incoming: FileList | File[]) {
    const accepted: File[] = []
    const rejected: string[] = []
    for (const file of Array.from(incoming)) {
      const problem = validatePhoto(file)
      if (problem) rejected.push(problem)
      else if (files.length + accepted.length >= MAX_PHOTOS) rejected.push(`${file.name}: at most ${MAX_PHOTOS} photos`)
      else accepted.push(file)
    }
    setProblems(rejected)
    if (accepted.length) onChange([...files, ...accepted])
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="photo-dropzone"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-input',
        )}
      >
        <p className="text-sm text-muted-foreground">Drag and drop photos here, or</p>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          Choose photos
        </Button>
        <p className="text-xs text-muted-foreground">JPEG, PNG or WebP · up to 5 MB each · max {MAX_PHOTOS}</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          aria-label="Upload photos"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = '' // allow picking the same file again after removing it
          }}
        />
      </div>

      {problems.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-xs text-destructive">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {previews.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Selected photos">
          {previews.map(({ file, url }, index) => (
            <li key={`${file.name}-${index}`} className="relative overflow-hidden rounded-lg border">
              <img src={url} alt={`Preview of ${file.name}`} className="aspect-video w-full object-cover" />
              <Button
                variant="secondary"
                size="sm"
                className="absolute top-1 right-1 h-7 px-2 text-xs"
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
