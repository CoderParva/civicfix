import { Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Category } from '@/types/api'

import { EXPLORE_PRIORITIES, EXPLORE_STATUSES, type ExploreState } from '../explore'
import { CategoryChips } from './CategoryChips'

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

type FilterKey = 'q' | 'category' | 'status' | 'priority'

interface ExploreFiltersProps {
  state: ExploreState
  categories: Category[]
  onChange: (key: FilterKey, value: string) => void
  onClear: () => void
  canClear: boolean
}

/** Keyword (client-side) + category/status/priority (applied by the backend). */
export function ExploreFilters({ state, categories, onChange, onClear, canClear }: ExploreFiltersProps) {
  return (
    <form
      role="search"
      aria-label="Filter issues"
      onSubmit={(e) => e.preventDefault()}
      className="grid gap-4 rounded-3xl border bg-card p-5 shadow-sm sm:grid-cols-2 sm:p-6 lg:grid-cols-4"
    >
      {categories.length > 0 && (
        <div className="sm:col-span-2 lg:col-span-4">
          <CategoryChips
            categories={categories}
            value={state.category}
            onChange={(value) => onChange('category', value)}
            groupLabel="Type of problem"
            allLabel="All types"
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
        <Label htmlFor="explore-q">Search</Label>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="explore-q"
            type="search"
            placeholder="Search title or description"
            value={state.q}
            onChange={(e) => onChange('q', e.target.value)}
            className="pl-10"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="explore-category">Category</Label>
        <select id="explore-category" className={SELECT_CLASS} value={state.category} onChange={(e) => onChange('category', e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="explore-status">Status</Label>
        <select id="explore-status" className={SELECT_CLASS} value={state.status} onChange={(e) => onChange('status', e.target.value)}>
          <option value="">All statuses</option>
          {EXPLORE_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="explore-priority">Priority</Label>
        <select id="explore-priority" className={SELECT_CLASS} value={state.priority} onChange={(e) => onChange('priority', e.target.value)}>
          <option value="">All priorities</option>
          {EXPLORE_PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <Button variant="ghost" size="sm" onClick={onClear} disabled={!canClear} className="h-11 rounded-xl">
          <X aria-hidden className="size-4" />
          Clear filters
        </Button>
      </div>
    </form>
  )
}
