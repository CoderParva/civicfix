import { Construction, CircleHelp, Droplets, Lightbulb, Route, Trash2, Waves, type LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

import { colorForCategory } from '@/features/map/palette'
import type { Category } from '@/types/api'
import { cn } from '@/utils/cn'

/**
 * One look per category: the colour is the map pin's colour (palette.ts, by category id), so a category is the
 * same colour on the map, on a card and on a tile; the icon comes from the category's `icon` key (what the
 * database seeds), falling back to its name for categories an admin adds later.
 */
const BY_ICON_KEY: Record<string, LucideIcon> = {
  pothole: Construction,
  trash: Trash2,
  lightbulb: Lightbulb,
  droplet: Droplets,
  waves: Waves,
  road: Route,
  'circle-help': CircleHelp,
}
const BY_NAME: [RegExp, LucideIcon][] = [
  [/pothole/i, Construction],
  [/garbage|trash|waste|litter/i, Trash2],
  [/light|lamp/i, Lightbulb],
  [/water|leak|pipe/i, Droplets],
  [/drain|sewer|flood/i, Waves],
  [/road|street|pavement/i, Route],
]

export function categoryIcon(category: Pick<Category, 'name' | 'icon'>): LucideIcon {
  return BY_ICON_KEY[category.icon] ?? BY_NAME.find(([pattern]) => pattern.test(category.name))?.[1] ?? CircleHelp
}

function mixHex(hex: string, other: [number, number, number], amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c, i) => Math.round(c * (1 - amount) + other[i] * amount))
  return `rgb(${channels.join(' ')})`
}

/** The colour and its derived tints as CSS variables (the vocabulary of the `.cat-*` classes and the cards). */
export function tintStyle(color: string): CSSProperties {
  return {
    '--cat': color,
    '--cat-soft': mixHex(color, [255, 255, 255], 0.88),
    '--cat-wash': mixHex(color, [255, 255, 255], 0.94),
    '--cat-line': mixHex(color, [255, 255, 255], 0.72),
    '--cat-ink': mixHex(color, [0, 0, 0], 0.28),
  } as CSSProperties
}

const styleCache = new Map<number, CSSProperties>()

/**
 * Inline style for one category: its colour plus the soft tint, line colour and readable ink. They are worked out
 * once per category here, not with `color-mix()` in the stylesheet, because a list shows dozens of cards and a
 * runtime colour mix per property per card made the list measurably slower to re-render.
 */
export function categoryStyle(categoryId: number): CSSProperties {
  let style = styleCache.get(categoryId)
  if (!style) {
    style = tintStyle(colorForCategory(categoryId))
    styleCache.set(categoryId, style)
  }
  return style
}

/** The categories the database ships with (migration 0002), for places that must not wait for the network. */
export const SEEDED_CATEGORIES: Category[] = [
  { id: 1, name: 'Pothole', icon: 'pothole' },
  { id: 2, name: 'Garbage', icon: 'trash' },
  { id: 3, name: 'Streetlight', icon: 'lightbulb' },
  { id: 4, name: 'Water leakage', icon: 'droplet' },
  { id: 5, name: 'Drainage', icon: 'waves' },
  { id: 6, name: 'Road damage', icon: 'road' },
]

/** A coloured rounded tile with the category's icon. Decorative: the category name is always shown next to it. */
export function CategoryIcon({ category, className, iconClassName }: { category: Category; className?: string; iconClassName?: string }) {
  const Icon = categoryIcon(category)
  return (
    <span aria-hidden style={categoryStyle(category.id)} className={cn('cat-icon size-10 rounded-xl', className)}>
      <Icon className={cn('size-5', iconClassName)} />
    </span>
  )
}

/** The category as a coloured pill with its icon and name. */
export function CategoryChip({ category, className }: { category: Category; className?: string }) {
  const Icon = categoryIcon(category)
  return (
    <span style={categoryStyle(category.id)} className={cn('cat-chip rounded-full px-2.5 py-0.5 text-xs', className)}>
      <Icon aria-hidden className="size-3.5" />
      {category.name}
    </span>
  )
}
