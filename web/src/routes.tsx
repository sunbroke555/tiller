import { Navigate, createBrowserRouter, type RouteObject } from 'react-router'

import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/components/layout/RequireAuth'
import { LoginPage } from '@/features/auth/LoginPage'
import { DatacenterPage } from '@/features/datacenter/DatacenterPage'
import { GuestPage } from '@/features/guest/GuestPage'
import { NodePage } from '@/features/node/NodePage'
import { NotFoundPage } from '@/features/NotFoundPage'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { AppearancePage } from '@/features/settings/AppearancePage'
import { ShellPage } from '@/features/shell/ShellPage'
import { StoragePage } from '@/features/storage/StoragePage'
import { TasksPage } from '@/features/tasks/TasksPage'

// Heavy features (console with noVNC/xterm, charts) should use `lazy` routes:
//   { path: 'console/...', lazy: () => import('@/features/console/route') }

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'guest/:node/:type/:vmid', element: <GuestPage /> },
      { path: 'node/:node', element: <NodePage /> },
      { path: 'storage', element: <StoragePage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'shell', element: <ShellPage /> },
      { path: 'datacenter', element: <DatacenterPage /> },
      { path: 'settings', element: <Navigate to="/settings/appearance" replace /> },
      { path: 'settings/appearance', element: <AppearancePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export function createRouter() {
  return createBrowserRouter(routes)
}
