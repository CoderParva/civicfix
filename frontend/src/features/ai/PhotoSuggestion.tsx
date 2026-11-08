import { Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { Category } from '@/types/api'
import type { CategorySuggestion, ClassificationResult } from '@/types/ai'

import { usePhotoSuggestion } from './hooks'

export const percent = (confidence: number) => `${Math.round(confidence * 100)}%`

interface PhotoSuggestionProps {
  /** The photo the suggestion is for (the first one chosen). */
  photo: File | null
  /** The category currently selected in the form (a category id as a string, or ''). */
  chosen: string
  categories: Category[]
  /** Called only when the person clicks a suggestion. Nothing is ever applied automatically. */
  onChoose: (categoryId: number) => void
}

/**
 * "What the photo looks like", with the model's confidence, and one click to accept. It never fills the
 * category by itself, never overrides a choice the person already made, and says nothing at all when
 * there is no AI (the form simply looks as it did before).
 */
export function PhotoSuggestion({ photo, chosen, categories, onChoose }: PhotoSuggestionProps) {
  const { data, isPending, isError } = usePhotoSuggestion(photo)
  if (!photo) return null

  if (isPending) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Looking at your photo…
      </p>
    )
  }
  if (isError || !data || data.status === 'unavailable') return null

  const known = new Set(categories.map((c) => c.id))
  const suggestions = data.suggestions.filter((s) => known.has(s.category_id))
  if (suggestions.length === 0) return null

  return (
    <div
      role="status"
      aria-label="Photo suggestion"
      data-testid="photo-suggestion"
      className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <Sparkles aria-hidden className="size-4 text-primary" />
        Suggestion from your photo
        <span className="text-xs font-normal text-muted-foreground">· only a suggestion, you decide</span>
      </p>
      {data.status === 'ok' ? (
        <Confident top={suggestions[0]} chosen={chosen} onChoose={onChoose} />
      ) : (
        <Unsure result={data} suggestions={suggestions} chosen={chosen} onChoose={onChoose} />
      )}
    </div>
  )
}

function Confident({ top, chosen, onChoose }: { top: CategorySuggestion; chosen: string; onChoose: (id: number) => void }) {
  const label = (
    <>
      This looks like <strong>{top.category_name}</strong> ({percent(top.confidence)} sure).
    </>
  )
  if (chosen === String(top.category_id)) {
    return <p>{label} That matches the category you picked.</p>
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p>
        {label}
        {chosen ? ' You chose something else; keep your choice if you know the place better.' : ''}
      </p>
      <Button size="sm" onClick={() => onChoose(top.category_id)}>
        {chosen ? `Switch to ${top.category_name}` : `Use ${top.category_name}`}
      </Button>
    </div>
  )
}

function Unsure({
  result,
  suggestions,
  chosen,
  onChoose,
}: {
  result: ClassificationResult
  suggestions: CategorySuggestion[]
  chosen: string
  onChoose: (id: number) => void
}) {
  const notCivic = result.reason === 'not_a_civic_issue'
  return (
    <div className="flex flex-col gap-3">
      <p>
        {notCivic
          ? 'This photo does not look like a street problem we know. You can still report it: choose the category yourself.'
          : 'We are not sure what this photo shows, so please choose the category yourself.'}
      </p>
      {!notCivic && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Closest guesses:</span>
          {suggestions.map((s) => (
            <Button
              key={s.category_id}
              size="sm"
              variant={chosen === String(s.category_id) ? 'default' : 'outline'}
              aria-pressed={chosen === String(s.category_id)}
              aria-label={`${s.category_name}, ${percent(s.confidence)}`}
              onClick={() => onChoose(s.category_id)}
            >
              {s.category_name} · {percent(s.confidence)}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
