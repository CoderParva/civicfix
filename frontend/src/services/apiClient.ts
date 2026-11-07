import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

import type { TokenPair } from '@/types/api'

import { getAuthHandlers, getRefreshToken, setRefreshToken } from './authBridge'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'

/** Endpoints where a 401 means "bad credentials", never "expired access token". */
const NO_REFRESH_PATHS = ['/auth/login/', '/auth/register/', '/auth/token/refresh/']

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

export const api = axios.create({ baseURL: API_URL })

// A bare instance for the refresh call itself: no interceptors, so it can never recurse into itself.
const bare = axios.create({ baseURL: API_URL })

api.interceptors.request.use((config) => {
  const token = getAuthHandlers()?.getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/**
 * Single-flight refresh. The backend rotates and blacklists refresh tokens, so two parallel
 * refreshes with the same token would make the second one fail and wrongly log the user out.
 * Every 401 that arrives while a refresh is running waits for that one refresh instead.
 */
let inFlight: Promise<string> | null = null

export function refreshAccessToken(): Promise<string> {
  if (!inFlight) {
    inFlight = (async () => {
      const refresh = getRefreshToken()
      if (!refresh) throw new Error('No refresh token')
      const { data } = await bare.post<Partial<TokenPair> & { access: string }>('/auth/token/refresh/', { refresh })
      const next = data.refresh ?? refresh // rotation is on, but don't assume it
      setRefreshToken(next)
      getAuthHandlers()?.onTokensRefreshed({ access: data.access, refresh: next })
      return data.access
    })().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined
    const status = error.response?.status
    const path = original?.url ?? ''

    if (status !== 401 || !original || original._retried || NO_REFRESH_PATHS.some((p) => path.includes(p))) {
      return Promise.reject(error)
    }

    original._retried = true // retry once; a second 401 means the new token is no good either
    try {
      const access = await refreshAccessToken()
      original.headers.Authorization = `Bearer ${access}`
      return api.request(original)
    } catch {
      setRefreshToken(null)
      getAuthHandlers()?.onAuthFailure()
      return Promise.reject(error)
    }
  },
)

/** A human-readable message from a DRF error response (detail, field errors, or a network failure). */
export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!axios.isAxiosError(error)) return fallback
  if (!error.response) return 'Cannot reach the server. Check your connection and try again.'
  const { status, data } = error.response
  if (status === 429) return 'Too many requests. Please wait a while before trying again.'
  if (data && typeof data === 'object') {
    if (typeof data.detail === 'string') return data.detail
    const first = Object.values(data as Record<string, unknown>).flat()[0]
    if (typeof first === 'string') return first
  }
  return fallback
}

/** DRF field errors ({field: [msg]}) as a flat {field: msg} map, for form.setError. */
export function getFieldErrors(error: unknown): Record<string, string> {
  if (!axios.isAxiosError(error) || error.response?.status !== 400) return {}
  const data = error.response.data
  if (!data || typeof data !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [field, value] of Object.entries(data as Record<string, unknown>)) {
    const message = Array.isArray(value) ? value[0] : value
    if (typeof message === 'string') out[field] = message
  }
  return out
}
