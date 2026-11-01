import { useEffect, useState } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { toast } from 'sonner'

import { startTicketRenewal } from '@/api/auth'
import { permissionsKey } from '@/api/permissions'
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
 * Session side effects: renew the ticket while logged in, drop cached data on
 * logout. Keyed by user name, so switching users in another tab (logout +
 * login as someone else) also clears the previous user's data.
 */
function SessionEffects({ queryClient }: { queryClient: QueryClient }) {
  const session = useSession()
  const user = session?.username ?? null
  useEffect(() => {
    if (!user) return
    const stop = startTicketRenewal({
      onExpiringSoon: (msLeft) =>
        toast.warning('无法续期登录', {
          id: 'ticket-expiring',
          description: `无法连接 PVE，登录将在 ${Math.max(1, Math.round(msLeft / 60_000))} 分钟后过期。恢复连接后会自动续期。`,
          duration: 15_000,
        }),
      // Privileges may have changed since the last ticket.
      onRenewed: () => void queryClient.invalidateQueries({ queryKey: permissionsKey() }),
    })
    return () => {
      stop()
      toast.dismiss('ticket-expiring')
      // Logged out (or user switched): never show the previous user's data.
      queryClient.removeQueries({ queryKey: queryKeys.all })
      resetTaskTracker()
    }
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
          <InstanceBoundary>
            <SessionEffects queryClient={queryClient} />
            <RouterProvider router={router} />
          </InstanceBoundary>
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
