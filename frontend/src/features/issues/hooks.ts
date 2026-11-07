import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { issuesApi } from '@/services/issuesApi'
import type { CreateIssuePayload, Issue } from '@/types/api'

import { filterBySearch, pageCount, paginate, toApiParams, type ExploreState } from './explore'

export const issueKeys = {
  mine: ['issues', 'mine'] as const,
  categories: ['categories'] as const,
  detail: (id: string) => ['issues', 'detail', id] as const,
  publicPage: (params: object, page: number) => ['issues', 'public', 'page', params, page] as const,
  publicAll: (params: object) => ['issues', 'public', 'all', params] as const,
}

/** All of the signed-in citizen's issues (every page), shared by the dashboard and My Reports. */
export function useMyIssues() {
  return useQuery({ queryKey: issueKeys.mine, queryFn: issuesApi.listMine })
}

export function useCategories() {
  return useQuery({ queryKey: issueKeys.categories, queryFn: issuesApi.getCategories, staleTime: 10 * 60_000 })
}

export function useIssue(id: string | undefined) {
  return useQuery({ queryKey: issueKeys.detail(id ?? ''), queryFn: () => issuesApi.getIssue(id!), enabled: !!id })
}

/**
 * Data for the Explore page. The backend applies category/status/priority (and paginates); the
 * keyword is matched client-side because the backend has no search param.
 *
 *  - list, no keyword: ONE backend page (true server-side pagination).
 *  - map, or any keyword: ALL pages of the filtered set (capped), because a map must show every
 *    pin and a keyword has to look beyond the current page to be correct. A keyword list is then
 *    paginated locally with the same page size.
 */
export function useExploreIssues(state: ExploreState) {
  const apiParams = toApiParams(state)
  const searching = state.q.trim() !== ''
  const needsAll = state.view === 'map' || searching

  const paged = useQuery({
    queryKey: issueKeys.publicPage(apiParams, state.page),
    queryFn: () => issuesApi.listPublicPage(apiParams, state.page),
    enabled: !needsAll,
    placeholderData: keepPreviousData,
  })
  const all = useQuery({
    queryKey: issueKeys.publicAll(apiParams),
    queryFn: () => issuesApi.listPublicAll(apiParams),
    enabled: needsAll,
    placeholderData: keepPreviousData,
  })

  const active = needsAll ? all : paged
  let issues: Issue[] = []
  let total = 0
  let truncated = false
  if (needsAll && all.data) {
    const matches = filterBySearch(all.data.items, state.q)
    issues = state.view === 'map' ? matches : paginate(matches, state.page)
    total = matches.length
    truncated = all.data.truncated
  } else if (!needsAll && paged.data) {
    issues = paged.data.results
    total = paged.data.count
  }

  return {
    issues,
    total,
    pageCount: pageCount(total),
    truncated,
    isPending: active.isPending,
    isError: active.isError,
    error: active.error,
    isPlaceholderData: active.isPlaceholderData,
    refetch: active.refetch,
  }
}

export interface SubmitReportInput {
  payload: CreateIssuePayload
  photos: File[]
}

export interface SubmitReportResult {
  issue: Issue
  /** Names of photos whose upload failed after the issue itself was created. */
  failedPhotos: string[]
}

/**
 * Two-step on the backend: create the issue (JSON), then upload each photo (multipart) to it.
 * Uploads run one at a time (the endpoint is rate limited) and a failed photo does not undo the
 * report: the caller is told which photos did not make it.
 */
export function useSubmitReport() {
  const queryClient = useQueryClient()
  return useMutation<SubmitReportResult, Error, SubmitReportInput>({
    mutationFn: async ({ payload, photos }) => {
      const issue = await issuesApi.createIssue(payload)
      const failedPhotos: string[] = []
      for (const photo of photos) {
        try {
          await issuesApi.uploadImage(issue.id, photo)
        } catch {
          failedPhotos.push(photo.name)
        }
      }
      return { issue, failedPhotos }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: issueKeys.mine }),
  })
}
