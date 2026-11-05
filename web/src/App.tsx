import { useEffect, useRef, useState } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'

import { AdminGate } from '@/features/auth/AdminGate'
import { queryKeys } from '@/api/queries'
import { useSession } from '@/api/useSession'
import { resetTaskTracker, setTaskQueryClient } from '@/components/tasks/tracker'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createQueryClient } from '@/lib/queryClient'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { InstanceBoundary } from '@/features/instances/InstanceBoundary'

import { createRouter } from './routes'

/**
 * Drop private cached data and task state when the administrator logs out.
 */
function SessionEffects({ queryClient }: { queryClient: QueryClient }) {
  const session = useSession()
  const user = session?.username ?? null
  const previousUser = useRef(user)
  useEffect(() => {
    const previous = previousUser.current
    previousUser.current = user
    if (!previous || previous === user) return
    // A boundary remount (including StrictMode) is not a logout. Removing
    // the catalog there would unmount the same boundary again in a loop.
    queryClient.removeQueries({ queryKey: ['instance-resources'] })
    queryClient.removeQueries({ queryKey: ['tiller-instances'] })
    queryClient.removeQueries({ queryKey: queryKeys.all })
    resetTaskTracker()
  }, [user, queryClient])
  return null
}

export function App() {
  const [queryClient] = useState(createQueryClient)
  // Finished tasks (runTask) refresh the queries on screen.
  useEffect(() => {
    setTaskQueryClient(queryClient)
    return () => setTaskQueryClient(null)
  }, [queryClient])
  const [router] = useState(createRouter)
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <SessionEffects queryClient={queryClient} />
          <AdminGate><InstanceBoundary>
            <RouterProvider router={router} />
          </InstanceBoundary></AdminGate>
          {/* Below the notch / Dynamic Island in the installed PWA (viewport-fit=cover). */}
          <Toaster
            position="top-center"
            offset={{ top: 'max(24px, env(safe-area-inset-top))' }}
            mobileOffset={{ top: 'max(16px, env(safe-area-inset-top))' }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
