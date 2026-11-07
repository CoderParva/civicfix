/**
 * Base map source: OpenFreeMap (free, no API key, built on OpenStreetMap data and meant for
 * production use). We deliberately do NOT use tile.openstreetmap.org: its usage policy forbids
 * heavy use by deployed apps and can be withdrawn without notice.
 *
 * OpenFreeMap serves VECTOR tiles (.pbf) plus a style document, not ready-made raster images, so
 * Leaflet draws it through the MapLibre GL bridge (see BaseMap). That is why this is a style URL
 * and not a `{z}/{x}/{y}.png` template.
 */
export const OPENFREEMAP_STYLE_URL: string =
  import.meta.env.VITE_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty'

/** Indore city centre: where the seeded demo data lives. */
export const DEFAULT_CENTER: [number, number] = [22.7196, 75.8577]
export const DEFAULT_ZOOM = 12
export const PICKED_ZOOM = 16
/**
 * Leaflet normally learns the zoom limits from its tile layer. Ours is the MapLibre GL layer, which
 * reports none, and marker clustering / fitBounds then throw "Map has no maxZoom specified".
 * OpenFreeMap's vector data stops at z14 but over-zooms cleanly, so 19 is a comfortable ceiling.
 */
export const MIN_ZOOM = 2
export const MAX_ZOOM = 19

/** MapLibre draws with WebGL; without it we show markers on a blank background plus a notice. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}
