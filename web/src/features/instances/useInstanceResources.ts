import { useQuery } from '@tanstack/react-query'

import { get } from '@/api/client'
import { getInstanceScope } from '@/api/instance-scope'
import type { PveInstance } from '@/api/instances'
import { POLL, queryKeys } from '@/api/queries'
import type { ClusterResource } from '@/api/types'

export function useInstanceResources(instance: PveInstance, expanded: boolean) {
  const scope = getInstanceScope()
  const active = instance.id === scope?.id && instance.version === scope.version
  return useQuery({
    // Share the active page's resource poll; other connections have separate caches.
    queryKey: active ? queryKeys.resources() : ['instance-resources', instance.id, instance.version, 'resources'],
    queryFn: async ({ signal }) => {
      const controller = new AbortController()
      const abort = () => controller.abort()
      if (signal.aborted) abort()
      signal.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(abort, 12_000)
      try {
        const data = await get<ClusterResource[]>('/cluster/resources', undefined, {
          instance, signal: controller.signal, noAuthRedirect: !active,
        })
        if (!Array.isArray(data)) throw new Error('PVE 返回的数据格式无效')
        return data
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
      }
    },
    enabled: !!instance.hasCredential && expanded,
    refetchInterval: expanded ? (active ? POLL.resources : 10_000) : false,
    staleTime: 5_000,
    retry: false,
  })
}
