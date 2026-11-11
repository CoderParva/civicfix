import { LayoutGrid } from 'lucide-react'

import type { Category } from '@/types/api'
import { cn } from '@/utils/cn'

import { categoryIcon, categoryStyle, tintStyle } from '../categoryVisual'

interface CategoryChipsProps {
  categories: Category[]
  /** The selected category id as a string, or '' for none / all. */
  value: string
  onChange: (value: string) => void
  /** Accessible name of the group. Keep it clear of the words the form's own labels use. */
  groupLabel: string
  /** Show a first "All types" chip that clears the choice (for filters). */
  allLabel?: string
  className?: string
  size?: 'md' | 'lg'
}

const NEUTRAL = tintStyle('#475569')

/** One-tap category picking, in the same colours as the map pins. A shortcut: the plain select stays the source of truth. */
export function CategoryChips({ categories, value, onChange, groupLabel, allLabel, className, size = 'md' }: CategoryChipsProps) {
  const sizing = size === 'lg' ? 'gap-2 rounded-2xl px-4 py-3 text-base' : 'gap-1.5 rounded-full px-3.5 py-1.5 text-sm'
  return (
    <div role="group" aria-label={groupLabel} className={cn('flex flex-wrap gap-2', className)}>
      {allLabel && (
        <button type="button" aria-pressed={value === ''} onClick={() => onChange('')} style={NEUTRAL} className={cn('cat-chip', sizing)}>
          <LayoutGrid aria-hidden className="size-4" />
          {allLabel}
        </button>
      )}
      {categories.map((category) => {
        const Icon = categoryIcon(category)
        const selected = value === String(category.id)
        return (
          <button
            key={category.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected && allLabel === undefined ? value : selected ? '' : String(category.id))}
            style={categoryStyle(category.id)}
            className={cn('cat-chip', sizing)}
          >
            <Icon aria-hidden className={size === 'lg' ? 'size-5' : 'size-4'} />
            {category.name}
          </button>
        )
      })}
    </div>
  )
}
