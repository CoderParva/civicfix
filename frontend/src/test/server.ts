import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { API_URL } from '@/services/apiClient'

/**
 * What the AI helpers answer unless a test says otherwise: "no model here, nothing similar nearby, nothing
 * recorded". This is also what production looks like, so every test that does not care about the AI runs
 * against the no-AI path. Tests of the AI features override these with server.use(...).
 */
export const aiDefaults = [
  http.post(`${API_URL}/ai/classify/`, () =>
    HttpResponse.json({ status: 'unavailable', reason: 'disabled', threshold: 0.5, suggestions: [], model: null }),
  ),
  http.post(`${API_URL}/ai/duplicates/`, () => HttpResponse.json({ method: 'none', radius_m: 150, matches: [] })),
  http.get(`${API_URL}/ai/analysis/:id/`, ({ params }) =>
    HttpResponse.json({
      id: null,
      issue_id: params.id,
      reported_category: '',
      processing_status: 'not_analyzed',
      model_name: '',
      model_version: '',
      predicted_category: '',
      confidence: null,
      duplicate_score: null,
      suggested_priority: '',
      result: {},
      created_at: null,
      updated_at: null,
    }),
  ),
]

/** Shared msw server: tests add per-test handlers with server.use(...). Unhandled requests fail loudly. */
export const server = setupServer(...aiDefaults)
