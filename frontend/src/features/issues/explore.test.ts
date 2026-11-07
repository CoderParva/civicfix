import { describe, expect, it } from 'vitest'

import { makeIssue } from '@/test/factories'

import {
  filterBySearch,
  hasActiveFilters,
  pageCount,
  paginate,
  parseExploreParams,
  toApiParams,
  toSearchParams,
  type ExploreState,
} from './explore'

const parse = (qs: string) => parseExploreParams(new URLSearchParams(qs))
const blank: ExploreState = { view: 'list', page: 1, q: '', category: '', status: '', priority: '' }

describe('parseExploreParams', () => {
  it('has sensible defaults', () => {
    expect(parse('')).toEqual(blank)
  })

  it('reads every param', () => {
    expect(parse('view=map&q=pothole&category=2&status=in_progress&priority=high&page=3')).toEqual({
      view: 'map',
      q: 'pothole',
      category: '2',
      status: 'in_progress',
      priority: 'high',
      page: 3,
    })
  })

  it.each([
    ['status=bogus', 'status'],
    ['status=rejected', 'status'], // never public, so not offered
    ['priority=urgent', 'priority'],
    ['priority=HIGH', 'priority'],
    ['category=abc', 'category'],
    ['category=-1', 'category'],
    ['category=1.5', 'category'],
  ])('drops an invalid value (%s) instead of sending it to the API', (qs, key) => {
    expect(parse(qs)[key as keyof ExploreState]).toBe('')
  })

  it.each(['0', '-2', 'x', '1.5', ''])('treats page=%s as page 1', (page) => {
    expect(parse(`page=${page}`).page).toBe(1)
  })

  it('only "map" switches the view', () => {
    expect(parse('view=map').view).toBe('map')
    expect(parse('view=grid').view).toBe('list')
  })
})

describe('toApiParams', () => {
  it('sends only the three backend filters, and omits empty ones', () => {
    expect(toApiParams({ category: '', status: '', priority: '' })).toEqual({})
    expect(toApiParams({ category: '2', status: '', priority: 'high' })).toEqual({ category: '2', priority: 'high' })
  })

  it('never includes the keyword (the backend has no search param)', () => {
    const state: ExploreState = { ...blank, q: 'pothole', status: 'resolved' }
    expect(Object.keys(toApiParams(state))).toEqual(['status'])
  })
})

describe('toSearchParams', () => {
  it('round-trips', () => {
    const state: ExploreState = { view: 'map', page: 2, q: 'water leak', category: '3', status: 'assigned', priority: 'low' }
    expect(parse(toSearchParams(state).toString())).toEqual(state)
  })

  it('leaves defaults out so URLs stay short', () => {
    expect(toSearchParams(blank).toString()).toBe('')
    expect(toSearchParams({ ...blank, page: 1, q: '   ' }).toString()).toBe('')
  })
})

describe('filterBySearch', () => {
  const issues = [
    makeIssue({ title: 'Deep Pothole on MG Road', description: 'Dangerous for bikes' }),
    makeIssue({ title: 'Garbage heap', description: 'Smells near the pothole repair site' }),
    makeIssue({ title: 'Broken streetlight', description: 'Dark at night' }),
  ]

  it('is case-insensitive and searches title and description', () => {
    expect(filterBySearch(issues, 'POTHOLE').map((i) => i.title)).toEqual(['Deep Pothole on MG Road', 'Garbage heap'])
    expect(filterBySearch(issues, 'dark').map((i) => i.title)).toEqual(['Broken streetlight'])
  })

  it('requires every word to match (AND)', () => {
    expect(filterBySearch(issues, 'pothole bikes').map((i) => i.title)).toEqual(['Deep Pothole on MG Road'])
    expect(filterBySearch(issues, 'pothole nothing')).toEqual([])
  })

  it('returns everything for a blank keyword, as a copy', () => {
    const all = filterBySearch(issues, '   ')
    expect(all).toEqual(issues)
    expect(all).not.toBe(issues)
  })

  it('treats regex characters literally', () => {
    expect(filterBySearch(issues, '.*')).toEqual([])
    expect(filterBySearch(issues, '(')).toEqual([])
  })
})

describe('pagination helpers', () => {
  it('pageCount is at least 1 and rounds up', () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(20)).toBe(1)
    expect(pageCount(21)).toBe(2)
    expect(pageCount(45)).toBe(3)
  })

  it('paginate slices by page', () => {
    const items = Array.from({ length: 45 }, (_, i) => i)
    expect(paginate(items, 1)).toHaveLength(20)
    expect(paginate(items, 3)).toEqual([40, 41, 42, 43, 44])
    expect(paginate(items, 4)).toEqual([])
  })
})

describe('hasActiveFilters', () => {
  it('is false for the blank state and true when anything is set', () => {
    expect(hasActiveFilters(blank)).toBe(false)
    expect(hasActiveFilters({ ...blank, q: '  ' })).toBe(false)
    for (const patch of [{ q: 'x' }, { category: '1' }, { status: 'resolved' }, { priority: 'low' }]) {
      expect(hasActiveFilters({ ...blank, ...patch })).toBe(true)
    }
  })
})
