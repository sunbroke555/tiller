import { useEffect, useState } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'

import { startTicketRenewal } from '@/api/auth'
import { queryKeys } from '@/api/queries'
import { useSession } from '@/api/useSession'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createQueryClient } from '@/lib/queryClient'
import { ThemeProvider } from '@/theme/ThemeProvider'

import { createRouter } from './routes'

/** Session side effects: renew the ticket while logged in, drop cached data on logout. */
function SessionEffects({ queryClient }: { queryClient: QueryClient }) {
  const session = useSession()
  const loggedIn = session !== null
  useEffect(() => {
    if (!loggedIn) return
    const stop = startTicketRenewal(() => {})
    return () => {
      stop()
      // Logged out (or user switched): never show the previous user's data.
      queryClient.removeQueries({ queryKey: queryKeys.all })
    }
  }, [loggedIn, queryClient])
  return null
}

export function App() {
  const [queryClient] = useState(createQueryClient)
  const [router] = useState(createRouter)
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <SessionEffects queryClient={queryClient} />
          <RouterProvider router={router} />
          <Toaster position="top-center" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
