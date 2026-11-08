import type { Category, CreateIssuePayload, Issue, IssueComment, IssueImage, Paginated } from '@/types/api'

import { api } from './apiClient'

/** The backend's page size (DRF PAGE_SIZE = 20); it is not client-configurable. */
export const PAGE_SIZE = 20
const MAX_PAGES = 50 // safety stop against a misbehaving `next`

/** Query params GET /issues/ understands. Leave a key out (not empty) to mean "no filter". */
export interface IssueListParams {
  mine?: boolean
  category?: string
  status?: string
  priority?: string
}

export interface AllPages<T> {
  items: T[]
  /** The backend's total (`count`), which can exceed items.length when we hit `maxPages`. */
  total: number
  truncated: boolean
}

/** Walk `/issues/` page by page (following the backend's own pagination) up to `maxPages`. */
async function fetchAllPages(params: IssueListParams, maxPages: number): Promise<AllPages<Issue>> {
  const items: Issue[] = []
  let total = 0
  let truncated = false
  for (let page = 1; page <= maxPages; page++) {
    const { data } = await api.get<Paginated<Issue>>('/issues/', { params: { ...params, page } })
    items.push(...data.results)
    total = data.count
    if (!data.next) break
    if (page === maxPages) truncated = true
  }
  return { items, total, truncated }
}

export const issuesApi = {
  getCategories: () => api.get<Category[]>('/categories/').then((r) => r.data),

  /**
   * Every issue the caller reported (any moderation state). The backend paginates (20/page) and
   * has no stats endpoint, so we walk the pages; the dashboard tallies the full list client-side.
   */
  listMine: () => fetchAllPages({ mine: true }, MAX_PAGES).then((r) => r.items),

  /** One backend page of public (approved) issues, with the backend's own filters applied. */
  listPublicPage: (params: IssueListParams, page: number) =>
    api.get<Paginated<Issue>>('/issues/', { params: { ...params, page } }).then((r) => r.data),

  /** All public issues matching the filters (for the map and for keyword search), capped. */
  listPublicAll: (params: IssueListParams, maxPages = 25) => fetchAllPages(params, maxPages),

  /** Comments an issue shows publicly (hidden ones are excluded by the API). */
  listComments: (id: string) =>
    api.get<Paginated<IssueComment>>(`/issues/${id}/comments/`).then((r) => r.data.results),

  getIssue: (id: string) => api.get<Issue>(`/issues/${id}/`).then((r) => r.data),

  createIssue: (payload: CreateIssuePayload) => api.post<Issue>('/issues/', payload).then((r) => r.data),

  uploadImage(issueId: string, file: File) {
    const form = new FormData()
    form.append('image', file)
    return api.post<IssueImage>(`/issues/${issueId}/images/`, form).then((r) => r.data)
  },
}
