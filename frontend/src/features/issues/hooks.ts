import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { issuesApi } from '@/services/issuesApi'
import type { CreateIssuePayload, Issue } from '@/types/api'

export const issueKeys = {
  mine: ['issues', 'mine'] as const,
  categories: ['categories'] as const,
}

/** All of the signed-in citizen's issues (every page), shared by the dashboard and My Reports. */
export function useMyIssues() {
  return useQuery({ queryKey: issueKeys.mine, queryFn: issuesApi.listMine })
}

export function useCategories() {
  return useQuery({ queryKey: issueKeys.categories, queryFn: issuesApi.getCategories, staleTime: 10 * 60_000 })
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
