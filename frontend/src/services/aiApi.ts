import type { AIAnalysis, ClassificationResult, DuplicateCheckPayload, DuplicatesResult } from '@/types/ai'

import { api } from './apiClient'

// Submitting a report waits for the duplicate check, so it gets a short leash: past this, the report just goes ahead.
const DUPLICATES_TIMEOUT_MS = 15_000
// A photo suggestion never blocks anything (the form stays usable meanwhile), but should not spin forever either.
const CLASSIFY_TIMEOUT_MS = 60_000

/**
 * Suggestions from the AI helpers. Every one of these is optional help: callers treat a failure the same
 * as "no suggestion" and carry on, so none of the report flow depends on the AI being up.
 */
export const aiApi = {
  /** Suggest a category from a photo (the same validation as an upload). */
  classifyPhoto(file: File) {
    const form = new FormData()
    form.append('image', file)
    return api.post<ClassificationResult>('/ai/classify/', form, { timeout: CLASSIFY_TIMEOUT_MS }).then((r) => r.data)
  },

  /** Reports near this spot that look like the same problem (citizens are only shown public ones). */
  findDuplicates: (payload: DuplicateCheckPayload) =>
    api.post<DuplicatesResult>('/ai/duplicates/', payload, { timeout: DUPLICATES_TIMEOUT_MS }).then((r) => r.data),

  /** What the helpers recorded for one issue (admin). `processing_status: "not_analyzed"` when nothing was recorded. */
  getAnalysis: (issueId: string) => api.get<AIAnalysis>(`/ai/analysis/${issueId}/`).then((r) => r.data),
}
