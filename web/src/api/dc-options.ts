// Endpoints of the dc-options area: datacenter options (/cluster/options) and
// node subscriptions (/nodes/{node}/subscription, /nodes/{node}/report).
//
// /cluster/options shares its query key with the other readers (tag style in
// TagChip / guest tags, default console, datacenter notes), so a save here
// refreshes them too. The subscription query shares the node-summary key.

import { useQuery } from '@tanstack/react-query'

import { del, get, isPveApiError, p, post, put, type Params } from './client'
import { nodeKeys, type NodeSubscription } from './node-summary'
import { queryKeys } from './queries'
import { clusterOptionsKey } from './shell'

export { clusterOptionsKey }
export type { NodeSubscription }

/**
 * GET /cluster/options. Property-string options come back parsed (objects)
 * except `bwlimit` and `location`, which are strings; lists are arrays.
 * `allowed-tags` is computed (user-allow-list + registered tags), and
 * `mac_prefix` / `description` are filled in even when not configured.
 */
export interface DcOptions {
  keyboard?: string
  language?: string
  console?: string
  http_proxy?: string
  email_from?: string
  mac_prefix?: string
  max_workers?: number | string
  fencing?: string
  description?: string
  /** base64 encoded UTF-8 Markdown. */
  'consent-text'?: string
  migration?: string | Record<string, unknown>
  replication?: string | Record<string, unknown>
  bwlimit?: string | Record<string, unknown>
  'next-id'?: string | Record<string, unknown>
  ha?: string | Record<string, unknown>
  crs?: string | Record<string, unknown>
  u2f?: string | Record<string, unknown>
  webauthn?: string | Record<string, unknown>
  'tag-style'?: string | Record<string, unknown>
  'user-tag-access'?: string | Record<string, unknown>
  'registered-tags'?: string | string[]
  'allowed-tags'?: string[]
  location?: string | Record<string, unknown>
  notify?: string | Record<string, unknown>
  [key: string]: unknown
}

export function useDcOptions() {
  return useQuery({
    queryKey: clusterOptionsKey(),
    queryFn: ({ signal }) => get<DcOptions>('/cluster/options', undefined, { signal }),
    // The page is the place where these change; keep it fresh while open.
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    retry: (n, e) => !(isPveApiError(e) && e.status === 403) && n < 1,
  })
}

/** PUT /cluster/options (synchronous). Needs Sys.Modify on /. */
export function setDcOptions(params: Params) {
  return put('/cluster/options', params)
}

// ------------------------------------------------------------ subscription

export const subscriptionKey = (node: string) => nodeKeys.subscription(node)

export function useSubscription(node: string | undefined) {
  return useQuery({
    queryKey: subscriptionKey(node ?? ''),
    queryFn: ({ signal }) => get<NodeSubscription>(p`/nodes/${node!}/subscription`, undefined, { signal }),
    enabled: !!node,
    staleTime: 30_000,
    retry: (n, e) => !(isPveApiError(e) && e.status < 500) && n < 1,
  })
}

/** PUT key=… (the key is checked online right away). */
export function uploadSubscriptionKey(node: string, key: string) {
  return put(p`/nodes/${node}/subscription`, { key })
}

/** POST force=1: check the key against the shop server now. */
export function checkSubscription(node: string) {
  return post(p`/nodes/${node}/subscription`, { force: 1 })
}

export function removeSubscription(node: string) {
  return del(p`/nodes/${node}/subscription`)
}

/** Keys refreshed after a subscription change (node status card, datacenter summary levels). */
export function subscriptionInvalidations(node: string) {
  return [subscriptionKey(node), queryKeys.clusterStatus(), queryKeys.nodes()] as const
}
