// Notifications and external metric servers (area notifications-metrics,
// /datacenter/notifications). See docs/feature-map.md §2.15.
//
//   GET                 /cluster/notifications/targets              all targets (name, type, origin, disable, comment)
//   POST                /cluster/notifications/targets/{name}/test  send a test notification
//   GET/POST            /cluster/notifications/endpoints/{type}     type: sendmail | smtp | gotify | webhook
//   GET/PUT/DELETE      /cluster/notifications/endpoints/{type}/{name}
//   GET/POST            /cluster/notifications/matchers
//   GET/PUT/DELETE      /cluster/notifications/matchers/{name}
//   GET                 /cluster/notifications/matcher-fields | matcher-field-values
//   GET                 /cluster/metrics/server
//   GET/POST/PUT/DELETE /cluster/metrics/server/{id}                 (create is POST on the id path)
//
// Notifications need Mapping.Audit / Mapping.Modify on /mapping/notifications,
// metric servers Sys.Audit / Sys.Modify on "/". Deleting a built-in target or
// matcher that was modified resets it to its defaults; unmodified built-ins
// cannot be deleted. Secrets (SMTP password, Gotify token, webhook secret
// values, InfluxDB token) are never returned.

import { useQueries, useQuery } from '@tanstack/react-query'

import { del, get, p, post, put, type Params } from './client'
import type { PveBool } from './types'

// ------------------------------------------------------------------ types

export const TARGET_TYPES = ['sendmail', 'smtp', 'gotify', 'webhook'] as const
export type TargetType = (typeof TARGET_TYPES)[number]
export const isTargetType = (t: string): t is TargetType => (TARGET_TYPES as readonly string[]).includes(t)

export type Origin = 'user-created' | 'builtin' | 'modified-builtin'

/** GET /cluster/notifications/targets entry. */
export interface NotificationTarget {
  name: string
  type: TargetType | string
  origin?: Origin
  disable?: PveBool | boolean
  comment?: string
}

/** One endpoint config (GET /cluster/notifications/endpoints/{type}[/{name}]); union of all types. */
export interface NotificationEndpoint {
  name: string
  origin?: Origin
  disable?: PveBool | boolean
  comment?: string
  digest?: string
  // sendmail + smtp
  mailto?: string[] | string
  'mailto-user'?: string[] | string
  author?: string
  'from-address'?: string
  // smtp
  server?: string
  port?: number
  mode?: 'insecure' | 'starttls' | 'tls'
  username?: string
  // gotify: server
  // webhook
  url?: string
  method?: 'get' | 'post' | 'put'
  /** "name=<name>,value=<base64>" property strings (secrets: name only). */
  header?: string[] | string
  secret?: string[] | string
  /** base64 */
  body?: string
  [key: string]: unknown
}

export interface NotificationMatcher {
  name: string
  origin?: Origin
  disable?: PveBool | boolean
  comment?: string
  digest?: string
  mode?: 'all' | 'any'
  'invert-match'?: PveBool | boolean
  'match-field'?: string[] | string
  'match-severity'?: string[] | string
  'match-calendar'?: string[] | string
  target?: string[] | string
}

export interface MatcherFieldValue {
  field: string
  value: string
  comment?: string
}

export const METRIC_TYPES = ['graphite', 'influxdb', 'opentelemetry'] as const
export type MetricType = (typeof METRIC_TYPES)[number]
export const isMetricType = (t: string): t is MetricType => (METRIC_TYPES as readonly string[]).includes(t)

/** GET /cluster/metrics/server[/{id}] entry. */
export interface MetricServer {
  id: string
  type: MetricType | string
  server: string
  port: number
  disable?: PveBool | boolean
  digest?: string
  // graphite
  path?: string
  proto?: 'udp' | 'tcp'
  timeout?: number
  mtu?: number
  // influxdb
  influxdbproto?: 'udp' | 'http' | 'https'
  organization?: string
  bucket?: string
  'api-path-prefix'?: string
  'max-body-size'?: number
  'verify-certificate'?: PveBool | boolean
  // opentelemetry
  'otel-protocol'?: 'http' | 'https'
  'otel-path'?: string
  'otel-timeout'?: number
  'otel-verify-ssl'?: PveBool | boolean
  'otel-max-body-size'?: number
  'otel-compression'?: 'gzip' | 'none'
  'otel-headers'?: string
  'otel-resource-attributes'?: string
  [key: string]: unknown
}

/** GET /access/users entry (recipient picker). */
export interface MailUser {
  userid: string
  email?: string
  firstname?: string
  lastname?: string
  comment?: string
  enable?: PveBool
}

// ------------------------------------------------------------- query keys

export const notificationKeys = {
  all: () => ['pve', 'cluster', 'notifications'] as const,
  targets: () => [...notificationKeys.all(), 'targets'] as const,
  endpoints: (type: TargetType) => [...notificationKeys.all(), 'endpoints', type] as const,
  endpoint: (type: TargetType, name: string) => [...notificationKeys.all(), 'endpoints', type, name] as const,
  matchers: () => [...notificationKeys.all(), 'matchers'] as const,
  matcher: (name: string) => [...notificationKeys.all(), 'matchers', name] as const,
  fields: () => [...notificationKeys.all(), 'matcher-fields'] as const,
  fieldValues: () => [...notificationKeys.all(), 'matcher-field-values'] as const,
  users: () => ['pve', 'access', 'users', 'mail'] as const,
}

export const metricKeys = {
  all: () => ['pve', 'cluster', 'metrics'] as const,
  list: () => [...metricKeys.all(), 'server'] as const,
  one: (id: string) => [...metricKeys.all(), 'server', id] as const,
}

// ---------------------------------------------------------------- queries

export function useNotificationTargets(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.targets(),
    queryFn: ({ signal }) => get<NotificationTarget[]>('/cluster/notifications/targets', undefined, { signal }),
    refetchInterval: 30_000,
    enabled,
  })
}

/** Full configs of every endpoint type (for the list's recipient / server summaries). */
export function useAllEndpoints(enabled = true) {
  const results = useQueries({
    queries: TARGET_TYPES.map((type) => ({
      queryKey: notificationKeys.endpoints(type),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        get<NotificationEndpoint[]>(p`/cluster/notifications/endpoints/${type}`, undefined, { signal }),
      refetchInterval: 30_000,
      enabled,
    })),
  })
  const map = new Map<string, NotificationEndpoint>()
  for (const r of results) for (const e of r.data ?? []) map.set(e.name, e)
  return map
}

export function fetchEndpoint(type: TargetType, name: string, signal?: AbortSignal) {
  return get<NotificationEndpoint>(p`/cluster/notifications/endpoints/${type}/${name}`, undefined, { signal })
}

export function useNotificationMatchers(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.matchers(),
    queryFn: ({ signal }) => get<NotificationMatcher[]>('/cluster/notifications/matchers', undefined, { signal }),
    refetchInterval: 30_000,
    enabled,
  })
}

export function fetchMatcher(name: string, signal?: AbortSignal) {
  return get<NotificationMatcher>(p`/cluster/notifications/matchers/${name}`, undefined, { signal })
}

export function useMatcherFields(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.fields(),
    queryFn: ({ signal }) => get<{ name: string }[]>('/cluster/notifications/matcher-fields', undefined, { signal }),
    staleTime: 5 * 60_000,
    enabled,
  })
}

export function useMatcherFieldValues(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.fieldValues(),
    queryFn: ({ signal }) => get<MatcherFieldValue[]>('/cluster/notifications/matcher-field-values', undefined, { signal }),
    staleTime: 5 * 60_000,
    enabled,
  })
}

/** Users with their mail addresses (sendmail / SMTP recipients). */
export function useMailUsers(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.users(),
    queryFn: ({ signal }) => get<MailUser[]>('/access/users', undefined, { signal }),
    staleTime: 60_000,
    enabled,
  })
}

export function useMetricServers(enabled = true) {
  return useQuery({
    queryKey: metricKeys.list(),
    queryFn: ({ signal }) => get<MetricServer[]>('/cluster/metrics/server', undefined, { signal }),
    refetchInterval: 30_000,
    enabled,
  })
}

/** One server's full config (the list only has id, type, server, port, disable; the detail lacks the id). */
export async function fetchMetricServer(id: string, signal?: AbortSignal): Promise<MetricServer> {
  return { ...(await get<MetricServer>(p`/cluster/metrics/server/${id}`, undefined, { signal })), id }
}

/** Full configs of the listed servers (protocol, path, org/bucket for the list rows). */
export function useMetricServerDetails(ids: readonly string[]) {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: metricKeys.one(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchMetricServer(id, signal),
      staleTime: 30_000,
    })),
  })
  const map = new Map<string, MetricServer>()
  for (const r of results) if (r.data) map.set(r.data.id, r.data)
  return map
}

// ---------------------------------------------------------------- writes

export const createEndpoint = (type: TargetType, params: Params) => post<null>(p`/cluster/notifications/endpoints/${type}`, params)
export const updateEndpoint = (type: TargetType, name: string, params: Params) =>
  put<null>(p`/cluster/notifications/endpoints/${type}/${name}`, params)
/** Delete a target (built-in, modified: reset to defaults). */
export const deleteEndpoint = (type: TargetType, name: string) => del<null>(p`/cluster/notifications/endpoints/${type}/${name}`)
export const testTarget = (name: string) => post<null>(p`/cluster/notifications/targets/${name}/test`)

export const createMatcher = (params: Params) => post<null>('/cluster/notifications/matchers', params)
export const updateMatcher = (name: string, params: Params) => put<null>(p`/cluster/notifications/matchers/${name}`, params)
export const deleteMatcher = (name: string) => del<null>(p`/cluster/notifications/matchers/${name}`)

export const createMetricServer = (id: string, params: Params) => post<null>(p`/cluster/metrics/server/${id}`, params)
export const updateMetricServer = (id: string, params: Params) => put<null>(p`/cluster/metrics/server/${id}`, params)
export const deleteMetricServer = (id: string) => del<null>(p`/cluster/metrics/server/${id}`)
