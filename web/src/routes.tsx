import type { ComponentType } from 'react'
import { Navigate, createBrowserRouter, type RouteObject } from 'react-router'

import { AppShell } from '@/components/layout/AppShell'
import { getInstanceScope, instanceBase } from '@/api/instance-scope'
import { RequireAuth } from '@/components/layout/RequireAuth'
import { RouteError } from '@/components/layout/RouteError'
import { DatacenterPage } from '@/features/datacenter/DatacenterPage'
import { GuestPage } from '@/features/guest/GuestPage'
import { NodePage } from '@/features/node/NodePage'
import { NotFoundPage } from '@/features/NotFoundPage'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { AppearancePage } from '@/features/settings/AppearancePage'
import { ShellPage } from '@/features/shell/ShellPage'
import { StoragePage } from '@/features/storage/StoragePage'
import { preloadTab } from '@/components/page/registry'
import { guestTabs } from '@/features/guest/registry'
import { nodeTabs } from '@/features/node/registry'
import { storageTabs } from '@/features/storage/registry'
import { datacenterSections } from '@/features/datacenter/registry'

/** Lazy route from a module whose default export is the page component. */
function page(load: () => Promise<{ default: ComponentType }>): Pick<RouteObject, 'lazy'> {
  return { lazy: async () => ({ Component: (await load()).default }) }
}

// Area pages are lazy so each area ships in its own chunk. Tabs inside the
// guest/node/storage pages are registered in features/<page>/registry.ts.
// Every route has an error element: after a deploy an open tab can no longer
// load the old lazy chunks, and render errors outside tab panels must not
// fall through to React Router's default screen.
export const routes: RouteObject[] = [
  { path: '/instances', ...page(() => import('@/features/instances/InstancesPage')), errorElement: <RouteError fullScreen /> },
  { path: '/login', element: <Navigate to="/" replace />, errorElement: <RouteError fullScreen /> },
  // Full-screen pages (no app frame).
  {
    element: <RequireAuth />,
    errorElement: <RouteError fullScreen />,
    children: [
      { path: 'console/:node/shell', ...page(() => import('@/features/console/ConsolePage')) },
      { path: 'console/:node/:type/:vmid', ...page(() => import('@/features/console/ConsolePage')) },
    ],
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    hydrateFallbackElement: <main className="grid min-h-dvh place-items-center text-sm text-muted-foreground" role="status">正在打开页面…</main>,
    // The frame itself failed.
    errorElement: <RouteError fullScreen />,
    children: [
      {
        // A page failed: keep the frame (navigation still works).
        errorElement: <RouteError />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'guest/:node/:type/:vmid/:tab?', element: <GuestPage />, loader: ({ params }) => preloadTab(guestTabs.filter((tab) => tab.types.some((type) => type === params.type)), params.tab ?? 'summary') },
          { path: 'node/:node/:tab?', element: <NodePage />, loader: ({ params }) => preloadTab(nodeTabs, params.tab ?? 'summary') },
          { path: 'storage', element: <StoragePage /> },
          { path: 'storage/:node/:storage/:tab?', ...page(() => import('@/features/storage/StorageDetailPage')), loader: ({ params }) => preloadTab(storageTabs, params.tab ?? 'summary') },
          { path: 'tasks', ...page(() => import('@/features/tasks/TasksPage')) },
          { path: 'cluster/log', ...page(() => import('@/features/tasks/ClusterLogPage')) },
          { path: 'create/qemu', ...page(() => import('@/features/guest-create/CreateQemuPage')) },
          { path: 'create/lxc', ...page(() => import('@/features/guest-create/CreateLxcPage')) },
          { path: 'shell', element: <ShellPage /> },
          { path: 'datacenter', element: <DatacenterPage /> },
          { path: 'datacenter/:section/*', ...page(() => import('@/features/datacenter/DatacenterSectionPage')), loader: ({ params }) => preloadTab(datacenterSections, params.section ?? '') },
          { path: 'pool', ...page(() => import('@/features/pool/PoolsPage')) },
          { path: 'pool/*', ...page(() => import('@/features/pool/PoolPage')) },
          { path: 'account', ...page(() => import('@/features/auth/AdminAccountPage')) },
          { path: 'account/permissions', ...page(() => import('@/features/account/PermissionsPage')) },
          { path: 'settings', element: <Navigate to="/settings/appearance" replace /> },
          { path: 'settings/appearance', element: <AppearancePage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

export function createRouter() {
  const globalRoutes: RouteObject[] = [
    { path: '/', ...page(() => import('@/features/instances/InstanceHome')), errorElement: <RouteError fullScreen /> },
    { path: '/instances', ...page(() => import('@/features/instances/InstancesPage')), errorElement: <RouteError fullScreen /> },
    { path: '/account', ...page(() => import('@/features/auth/AdminAccountPage')), errorElement: <RouteError fullScreen /> },
    { path: '*', element: <Navigate to="/" replace /> },
  ]
  return createBrowserRouter(getInstanceScope() ? routes : globalRoutes, { basename: instanceBase() || '/' })
}
