import { PAGE_SIZE, type IssueListParams } from '@/services/issuesApi'
import type { Issue, IssuePriority, IssueStatus } from '@/types/api'

/** Statuses that can appear publicly (rejected issues are never public). */
export const EXPLORE_STATUSES: { value: IssueStatus; label: string }[] = [
  { value: 'reported', label: 'Reported' },
  { value: 'under_review', label: 'Under review' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'reopened', label: 'Reopened' },
]

export const EXPLORE_PRIORITIES: { value: IssuePriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

export type ExploreView = 'list' | 'map'

export interface ExploreState {
  view: ExploreView
  page: number
  /** Keyword, matched client-side against title and description. */
  q: string
  category: string
  status: string
  priority: string
}

const isStatus = (v: string) => EXPLORE_STATUSES.some((s) => s.value === v)
const isPriority = (v: string) => EXPLORE_PRIORITIES.some((p) => p.value === v)

/** Read the page state from the URL. Anything invalid is dropped, never sent to the API. */
export function parseExploreParams(params: URLSearchParams): ExploreState {
  const page = Number(params.get('page'))
  const category = params.get('category') ?? ''
  const status = params.get('status') ?? ''
  const priority = params.get('priority') ?? ''
  return {
    view: params.get('view') === 'map' ? 'map' : 'list',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    q: params.get('q') ?? '',
    category: /^\d+$/.test(category) ? category : '',
    status: isStatus(status) ? status : '',
    priority: isPriority(priority) ? priority : '',
  }
}

/** The filters the BACKEND applies (category, status, priority). Empty ones are omitted entirely. */
export function toApiParams(state: Pick<ExploreState, 'category' | 'status' | 'priority'>): IssueListParams {
  const params: IssueListParams = {}
  if (state.category) params.category = state.category
  if (state.status) params.status = state.status
  if (state.priority) params.priority = state.priority
  return params
}

/** Serialise state to a query string, leaving defaults out so URLs stay short and shareable. */
export function toSearchParams(state: ExploreState): URLSearchParams {
  const out = new URLSearchParams()
  if (state.view === 'map') out.set('view', 'map')
  if (state.q.trim()) out.set('q', state.q)
  if (state.category) out.set('category', state.category)
  if (state.status) out.set('status', state.status)
  if (state.priority) out.set('priority', state.priority)
  if (state.page > 1) out.set('page', String(state.page))
  return out
}

/** Case-insensitive keyword search over title and description. Every word must match somewhere. */
export function filterBySearch(issues: readonly Issue[], q: string): Issue[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...issues]
  return issues.filter((issue) => {
    const haystack = `${issue.title} ${issue.description}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

export function pageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

export function paginate<T>(items: readonly T[], page: number, pageSize = PAGE_SIZE): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize)
}

export function hasActiveFilters(state: ExploreState): boolean {
  return Boolean(state.q.trim() || state.category || state.status || state.priority)
}
