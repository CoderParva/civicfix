import type { IssuePriority, IssueStatus } from './api'

/** "ok": confident. "uncertain": the person should choose (guesses still listed). "unavailable": no model here. */
export type ClassificationStatus = 'ok' | 'uncertain' | 'unavailable'

export interface CategorySuggestion {
  category_id: number
  category_name: string
  /** 0..1 */
  confidence: number
}

export interface ClassificationResult {
  status: ClassificationStatus
  /** confident | low_confidence | ambiguous | not_a_civic_issue | disabled | model_unavailable | error | no_categories */
  reason: string
  threshold: number
  suggestions: CategorySuggestion[]
  model: { name: string; version: string } | null
  /** Only on a stored analysis: did the model's top guess match what the reporter chose? */
  agrees_with_reporter?: boolean
}

export interface DuplicateMatch {
  id: string
  reference_number: string
  title: string
  category: { id: number; name: string }
  status: IssueStatus
  distance_m: number
  /** 0..1 */
  score: number
  text_similarity: number
  likelihood: 'likely' | 'possible'
  reported_at: string
}

export interface DuplicatesResult {
  method: 'semantic' | 'lexical' | 'none'
  radius_m: number
  matches: DuplicateMatch[]
}

export interface DuplicateCheckPayload {
  latitude: number
  longitude: number
  title: string
  description: string
  category?: number
}

export interface PriorityReason {
  factor: string
  detail: string
  points: number
}

export interface PriorityRecommendation {
  priority: IssuePriority
  score: number
  reasons: PriorityReason[]
  method: 'rules'
  version: string
}

export type AnalysisStatus = 'completed' | 'partial' | 'failed' | 'not_analyzed'

export interface AIAnalysis {
  id: string | null
  issue_id: string
  reported_category: string
  processing_status: AnalysisStatus
  model_name: string
  model_version: string
  predicted_category: string
  confidence: number | null
  duplicate_score: number | null
  suggested_priority: IssuePriority | ''
  result: {
    priority?: PriorityRecommendation
    duplicates?: DuplicatesResult
    classification?: ClassificationResult
  }
  created_at: string | null
  updated_at: string | null
}
