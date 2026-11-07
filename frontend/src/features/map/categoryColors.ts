import L from 'leaflet'

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

/** HTML for a pin. Only ever built from palette constants, never from user-supplied text. */
export function pinHtml(color: string): string {
  return `<span class="civicfix-pin__dot" style="background:${color}"></span>`
}

const iconCache = new Map<string, L.DivIcon>()

/** A round coloured pin as a DivIcon (no image files, so no bundler asset-path problems). */
export function pinIcon(color: string): L.DivIcon {
  let icon = iconCache.get(color)
  if (!icon) {
    icon = L.divIcon({ className: 'civicfix-pin', html: pinHtml(color), iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12] })
    iconCache.set(color, icon)
  }
  return icon
}
