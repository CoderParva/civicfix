import { cn } from '@/utils/cn'

export interface Segment<T extends string> {
  value: T
  label: string
  /** Optional count shown after the label. */
  count?: number
}

interface SegmentedControlProps<T extends string> {
  label: string
  value: T
  options: Segment<T>[]
  onChange: (value: T) => void
}

/** A compact one-of-N filter. Buttons with aria-pressed, so it is keyboard and screen-reader friendly. */
export function SegmentedControl<T extends string>({ label, value, options, onChange }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit max-w-full flex-wrap rounded-md bg-muted p-1">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'type-body inline-flex h-8 items-center gap-2 rounded-[5px] px-4 font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
              active ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
            {option.count !== undefined && <span className="type-caption tabular">{option.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
