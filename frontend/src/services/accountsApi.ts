import type { LoginResponse, TokenPair, User } from '@/types/api'

import { api } from './apiClient'

export interface RegisterPayload {
  email: string
  full_name: string
  password: string
  phone_number?: string
  city?: string
  state?: string
}

export const accountsApi = {
  register: (payload: RegisterPayload) => api.post<User>('/auth/register/', payload).then((r) => r.data),
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login/', { email, password }).then((r) => r.data),
  refresh: (refresh: string) => api.post<TokenPair>('/auth/token/refresh/', { refresh }).then((r) => r.data),
  getProfile: () => api.get<User>('/auth/profile/').then((r) => r.data),
}
