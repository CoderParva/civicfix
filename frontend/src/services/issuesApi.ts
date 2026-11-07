import type { Category, CreateIssuePayload, Issue, IssueImage, Paginated } from '@/types/api'

import { api } from './apiClient'

const MAX_PAGES = 50 // safety stop against a misbehaving `next`

export const issuesApi = {
  getCategories: () => api.get<Category[]>('/categories/').then((r) => r.data),

  /**
   * Every issue the caller reported (any moderation state). The backend paginates (20/page) and
   * has no stats endpoint, so we walk the pages; the dashboard tallies the full list client-side.
   */
  async listMine(): Promise<Issue[]> {
    const all: Issue[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data } = await api.get<Paginated<Issue>>('/issues/', { params: { mine: true, page } })
      all.push(...data.results)
      if (!data.next) break
    }
    return all
  },

  createIssue: (payload: CreateIssuePayload) => api.post<Issue>('/issues/', payload).then((r) => r.data),

  uploadImage(issueId: string, file: File) {
    const form = new FormData()
    form.append('image', file)
    return api.post<IssueImage>(`/issues/${issueId}/images/`, form).then((r) => r.data)
  },
}
