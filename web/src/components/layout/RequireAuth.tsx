import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'

import { useSession } from '@/api/useSession'

/**
 * Redirects to /login (remembering where to come back) when logged out.
 * Without children it renders the nested routes (layout route).
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const session = useSession()
  const location = useLocation()
  if (!session) {
    const next = location.pathname + location.search
    const to = next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'
    return <Navigate to={to} replace />
  }
  return children ?? <Outlet />
}
