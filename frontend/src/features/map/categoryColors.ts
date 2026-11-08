import L from 'leaflet'

import { CATEGORY_PALETTE, colorForCategory, FALLBACK_COLOR } from './palette'

// re-exported so existing imports (and the map code) keep working
export { CATEGORY_PALETTE, colorForCategory, FALLBACK_COLOR }

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
