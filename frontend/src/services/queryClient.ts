import { QueryClient } from '@tanstack/react-query'
import axios from 'axios'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retry network blips and 5xx, never 4xx (a 403/404 will not fix itself).
        retry: (failureCount, error) => {
          const status = axios.isAxiosError(error) ? error.response?.status : undefined
          if (status && status < 500) return false
          return failureCount < 2
        },
      },
    },
  })
}
