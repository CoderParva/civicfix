/**
 * One colour per category. Categories live in the database, so colours are assigned by category
 * id from a fixed palette: the same category always gets the same colour on every page and in the
 * legend, with no per-category configuration. (More categories than colours wrap around.)
 */
export const CATEGORY_PALETTE = [
  '#2563eb', // blue
  '#16a34a', // green
  '#d97706', // amber
  '#dc2626', // red
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#db2777', // pink
  '#4b5563', // slate
] as const

export const FALLBACK_COLOR = '#6b7280'

export function colorForCategory(categoryId: number): string {
  if (!Number.isInteger(categoryId) || categoryId < 1) return FALLBACK_COLOR
  return CATEGORY_PALETTE[(categoryId - 1) % CATEGORY_PALETTE.length]
}
