import { QueryClient } from '@tanstack/react-query'

import { isClientError } from '@/api/client'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2_000,
        // Polling pauses while the tab is hidden and resumes on focus.
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // Client errors (auth, permission, validation) will not fix themselves.
          if (isClientError(error)) return false
          return failureCount < 2
        },
      },
      mutations: { retry: false },
    },
  })
}
