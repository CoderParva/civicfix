import { describe, expect, it } from 'vitest'

import { CATEGORY_PALETTE, colorForCategory, FALLBACK_COLOR, pinHtml, pinIcon } from './categoryColors'
import { formatCoordinate, parseCoordinatePair } from './coordinates'
import { OPENFREEMAP_STYLE_URL } from './tiles'

describe('category colours', () => {
  it('gives the same category the same colour every time', () => {
    expect(colorForCategory(3)).toBe(colorForCategory(3))
  })

  it('gives each of the first palette-size categories a different colour', () => {
    const colors = Array.from({ length: CATEGORY_PALETTE.length }, (_, i) => colorForCategory(i + 1))
    expect(new Set(colors).size).toBe(CATEGORY_PALETTE.length)
  })

  it('wraps around instead of failing when there are more categories than colours', () => {
    expect(colorForCategory(CATEGORY_PALETTE.length + 1)).toBe(colorForCategory(1))
  })

  it.each([0, -3, 1.5, Number.NaN])('falls back to grey for an invalid id (%s)', (id) => {
    expect(colorForCategory(id)).toBe(FALLBACK_COLOR)
  })

  it('builds the pin from the colour and caches the icon per colour', () => {
    const color = colorForCategory(2)
    expect(pinHtml(color)).toContain(`background:${color}`)
    expect(pinIcon(color)).toBe(pinIcon(color))
    expect(pinIcon(color).options.html).toContain(color)
    expect(pinIcon(colorForCategory(1))).not.toBe(pinIcon(color))
  })
})

describe('parseCoordinatePair (what the map pin follows)', () => {
  it('returns the point for valid numbers', () => {
    expect(parseCoordinatePair('22.7196', '75.8577')).toEqual({ latitude: 22.7196, longitude: 75.8577 })
  })

  it('accepts negatives, whitespace and the boundaries', () => {
    expect(parseCoordinatePair(' -33.86 ', '151.2')).toEqual({ latitude: -33.86, longitude: 151.2 })
    expect(parseCoordinatePair('90', '-180')).toEqual({ latitude: 90, longitude: -180 })
  })

  it.each([
    ['empty latitude', '', '75.8'],
    ['empty longitude', '22.7', ''],
    ['whitespace only', '  ', '75.8'],
    ['not a number', 'north', '75.8'],
    ['half-typed', '22.', 'abc'],
    ['latitude above 90', '90.0001', '75.8'],
    ['latitude below -90', '-91', '75.8'],
    ['longitude above 180', '22.7', '181'],
    ['longitude below -180', '22.7', '-180.5'],
    ['Infinity', 'Infinity', '75.8'],
  ])('gives no pin for %s', (_label, lat, lng) => {
    expect(parseCoordinatePair(lat, lng)).toBeNull()
  })
})

describe('formatCoordinate', () => {
  it('uses 6 decimals', () => {
    expect(formatCoordinate(22.71956789)).toBe('22.719568')
    expect(formatCoordinate(75)).toBe('75.000000')
  })
})

describe('base map source', () => {
  it('uses OpenFreeMap, not the raw OpenStreetMap tile server', () => {
    const host = new URL(OPENFREEMAP_STYLE_URL).host
    expect(host).toBe('tiles.openfreemap.org')
    expect(OPENFREEMAP_STYLE_URL).not.toContain('openstreetmap')
  })

  it('no source file points at the raw OpenStreetMap tile server (policy guard)', () => {
    const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const offenders = Object.entries(sources)
      .filter(([file]) => !file.includes('.test.'))
      // a URL (https://tile.openstreetmap.org, //{s}.tile.openstreetmap.org); prose about it is fine
      .filter(([, text]) => /\/\/[\w.{}-]*tile\.openstreetmap\.org/.test(text))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})
