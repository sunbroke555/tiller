// The current user's effective privileges (GET /access/permissions) and the
// hooks that make the UI permission-aware. Pure logic: lib/permissions.ts.
//
//   const perms = usePermissions()
//   perms.can({ privs: 'Sys.Modify' })                                   // on "/"
//   perms.can({ privs: 'VM.PowerMgmt' }, { kind: 'guest', vmid: 100, pool })
//
// Registries (guest/node/storage actions, palette commands) are filtered by
// the page shells with `allowedFor(perms, action, ctx, target)`.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { get } from './client'
import { useSession } from './useSession'
import { createPermissionChecker, type PermissionChecker, type PermissionMap } from '@/lib/permissions'

export const permissionsKey = () => ['pve', 'access', 'permissions'] as const

/** Effective privileges of the logged-in user on every ACL path. */
export function useOwnPermissions() {
  const session = useSession()
  return useQuery({
    queryKey: [...permissionsKey(), session?.username ?? ''],
    queryFn: ({ signal }) => get<PermissionMap>('/access/permissions', undefined, { signal }),
    enabled: !!session,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  })
}

/** Permission checker for the current user (ticket caps until the map loads). */
export function usePermissions(): PermissionChecker {
  const session = useSession()
  const { data } = useOwnPermissions()
  const cap = session?.cap
  return useMemo(() => createPermissionChecker(data, cap), [data, cap])
}
