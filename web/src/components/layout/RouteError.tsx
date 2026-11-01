import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'

import { ErrorFallback } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'

/**
 * Route `errorElement`: a lazy page chunk that no longer exists after a
 * deploy, or a render error outside the tab panels, shows the app's own
 * error card instead of React Router's default screen. `fullScreen` for
 * routes without the app frame (or when the frame itself failed).
 */
export function RouteError({ fullScreen = false }: { fullScreen?: boolean }) {
  const error = useRouteError()
  useEffect(() => {
    console.error('Route error', error)
  }, [error])

  const shown = isRouteErrorResponse(error) ? new Error(`${error.status} ${error.statusText || ''}`.trim()) : error
  // A full page load: the router or the frame may be what failed.
  const home = (
    <Button asChild variant="ghost">
      <a href="/">回到概览</a>
    </Button>
  )
  const card = <ErrorFallback error={shown} extraAction={home} />
  if (!fullScreen) return <div className="mt-8">{card}</div>
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md">{card}</div>
    </div>
  )
}
