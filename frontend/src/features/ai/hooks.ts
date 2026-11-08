import { useQuery } from '@tanstack/react-query'

import { aiApi } from '@/services/aiApi'

/**
 * Category suggestion for one photo. Keyed on the file itself, so it runs once per photo and never again
 * on re-render. A failure is just "no suggestion": no retries, and the form never waits on it.
 */
export function usePhotoSuggestion(photo: File | null) {
  return useQuery({
    queryKey: ['ai', 'classify', photo?.name, photo?.size, photo?.lastModified],
    queryFn: () => aiApi.classifyPhoto(photo as File),
    enabled: photo !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  })
}

/** The admin's view of what the AI helpers recorded for an issue. */
export function useAiAnalysis(issueId: string | undefined) {
  return useQuery({
    queryKey: ['ai', 'analysis', issueId],
    queryFn: () => aiApi.getAnalysis(issueId as string),
    enabled: !!issueId,
    retry: false,
  })
}
