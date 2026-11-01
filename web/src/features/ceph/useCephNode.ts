import { useMemo } from 'react'

import { useCephMetadata } from '@/api/ceph'
import { useClusterResources } from '@/api/queries'
import { isNode } from '@/api/types'

export interface CephNodes {
  /** Online nodes, sorted by name. */
  online: string[]
  /** Nodes with Ceph installed (from /cluster/ceph/metadata?scope=versions), when known. */
  installed: string[] | undefined
  /**
   * Node used for the cluster-wide node-scoped reads (pools, OSD tree, mons…):
   * the first online node with Ceph installed, else the first online node.
   */
  apiNode: string | undefined
}

export function useCephNodes(): CephNodes {
  const resources = useClusterResources()
  const versions = useCephMetadata('versions')
  return useMemo(() => {
    const online = (resources.data ?? [])
      .filter(isNode)
      .filter((n) => n.status === 'online')
      .map((n) => n.node)
      .sort()
    const installed = versions.data?.node ? Object.keys(versions.data.node).sort() : undefined
    const apiNode = online.find((n) => installed?.includes(n)) ?? online[0]
    return { online, installed, apiNode }
  }, [resources.data, versions.data])
}
