import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { parseExploreParams, toSearchParams, type ExploreState } from './explore'

const keyOf = (state: ExploreState) => toSearchParams(state).toString()

interface UpdateOptions {
  /** Keep the current page instead of going back to page 1 (for the pager and the list/map toggle). */
  resetPage?: boolean
  /** Replace the history entry instead of adding one (for typing, so the back button is not buried in keystrokes). */
  replace?: boolean
}

/**
 * The Explore page's filter state: shown from local state, mirrored into the URL.
 *
 * Why not just read the URL on every render? The router reports a new URL back to React *after* the click or
 * keystroke that asked for it (navigations are applied in a transition: tens to hundreds of milliseconds on a
 * slow or busy page). If the page is drawn from the URL it is always a step behind, and anything done in that
 * gap is lost or undone: text typed right after "Clear filters" is wiped when the older render lands, fast
 * typing is overwritten by echoes of earlier keystrokes, and a filter changed from a stale snapshot brings back
 * filters that were just cleared.
 *
 * So the local state is the one the person is looking at, and it changes at once. Each change is also pushed to
 * the URL, and the pushes are remembered until the router reports them back; such an echo (even a late or
 * skipped-ahead one) is recognised and ignored. A URL change that is NOT one of ours (back/forward, a link, an
 * edited address) is adopted, so the page still follows the address bar.
 */
export function useExploreState() {
  const [params, setParams] = useSearchParams()
  const urlState = parseExploreParams(params)
  const urlKey = keyOf(urlState)

  const [state, setState] = useState<ExploreState>(urlState)
  /** The newest state, readable synchronously, so an update never builds on a stale render's copy. */
  const latest = useRef(state)
  /** Queries we asked the router for that it has not reported back yet, oldest first. */
  const pending = useRef<string[]>([])
  /** The query the URL last reported. */
  const reported = useRef(urlKey)

  const show = useCallback((next: ExploreState) => {
    latest.current = next
    setState(next)
  }, [])

  useEffect(() => {
    if (urlKey === reported.current) return
    reported.current = urlKey
    const at = pending.current.indexOf(urlKey)
    if (at >= 0) {
      pending.current.splice(0, at + 1) // our own request coming back (the router may skip intermediate ones)
      return
    }
    pending.current = [] // somebody else changed the URL: whatever we were waiting for is moot
    show(parseExploreParams(new URLSearchParams(urlKey)))
  }, [urlKey, show])

  const commit = useCallback(
    (next: ExploreState, replace: boolean) => {
      show(next)
      const key = keyOf(next)
      if (key === (pending.current.at(-1) ?? reported.current)) return // the URL already is, or is about to be, this
      pending.current.push(key)
      setParams(toSearchParams(next), { replace })
    },
    [setParams, show],
  )

  /** Change part of the state. Filters reset to page 1; typing replaces history instead of piling it up. */
  const update = useCallback(
    (patch: Partial<ExploreState>, opts: UpdateOptions = {}) => {
      const current = latest.current
      commit({ ...current, ...patch, page: opts.resetPage === false ? (patch.page ?? current.page) : 1 }, opts.replace ?? false)
    },
    [commit],
  )

  const clear = useCallback(() => commit({ ...latest.current, q: '', category: '', status: '', priority: '', page: 1 }, false), [commit])

  /** A stale or hand-edited page number past the end: fall back to page 1 without adding history. */
  const backToFirstPage = useCallback(() => commit({ ...latest.current, page: 1 }, true), [commit])

  return { state, update, clear, backToFirstPage }
}
