import type { PickedPoint } from './LocationPicker'

/** Format a coordinate for the form fields: 6 decimals is ~0.1 m, plenty for a pothole. */
export function formatCoordinate(value: number): string {
  return value.toFixed(6)
}

/**
 * The map pin for what is currently typed in the latitude/longitude fields: a point only when both
 * are valid numbers in range, otherwise null (no pin, never a half-typed value like "22.").
 */
export function parseCoordinatePair(latitude: string, longitude: string): PickedPoint | null {
  const lat = parseOne(latitude)
  const lng = parseOne(longitude)
  if (lat === null || lng === null) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { latitude: lat, longitude: lng }
}

function parseOne(raw: string): number | null {
  const text = raw.trim()
  if (text === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}
