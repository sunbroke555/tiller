import type { QueryKey } from '@tanstack/react-query'

import { networkKeys } from '@/api/node-network'
import { queryKeys } from '@/api/queries'

/** Queries to refresh after a network write: this tab and the bridge pickers of the node. */
export const networkInvalidate = (node: string): QueryKey[] => [networkKeys.config(node), [...queryKeys.node(node), 'network-list']]
