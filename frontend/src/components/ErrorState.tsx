import { TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function ErrorState({
  message = 'Something went wrong.',
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <span data-tone="danger" className="tone-chip flex size-12 items-center justify-center rounded-full border">
        <TriangleAlert aria-hidden className="size-5" />
      </span>
      <p className="type-body max-w-md text-destructive">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
