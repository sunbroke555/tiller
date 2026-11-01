// Firewall (area firewall): one API layer for every scope.
//
//   datacenter  /cluster/firewall                    rules, groups, aliases, ipset, options, refs, macros
//   node        /nodes/{node}/firewall               rules, options, log
//   guest       /nodes/{node}/{qemu|lxc}/{vmid}/firewall   rules, options, aliases, ipset, log, refs
//   vnet        /cluster/sdn/vnets/{vnet}/firewall   rules, options (forward only)
//   group       /cluster/firewall/groups/{group}     the rules of one security group
//
// Every write is synchronous (returns null). Rule positions are indexes into
// the list, so position-based writes carry the digest of the list they were
// computed from; PVE rejects them when the file changed meanwhile.
//
//   POST rules             creates the rule at the top (pos 0) — there is no insert position
//   PUT  rules/{pos}       moveto=<i>: remove the rule, insert it before the rule that was at i
//   DELETE rules/{pos}     ?digest=
//   POST groups            group=<new> [rename=<old>] comment — rename/update
//   POST ipset             name=<new> [rename=<old>] comment — rename/update
//   DELETE ipset/{name}    force=1 removes the members too
//   GET  log               start, limit, since, until (Unix seconds) → [{n, t}] + total

import { useQuery } from '@tanstack/react-query'

import { del, get, p, post, put, requestEnvelope, type Params } from './client'
import { queryKeys } from './queries'
import type { GuestType } from './types'

// ------------------------------------------------------------------ scope

export type FirewallScope =
  | { kind: 'dc' }
  | { kind: 'node'; node: string }
  | { kind: 'guest'; node: string; type: GuestType; vmid: number }
  | { kind: 'vnet'; vnet: string }
  | { kind: 'group'; group: string }

/** Base path of a scope's firewall ("/cluster/firewall", "/nodes/pve/firewall", …). */
export function firewallBase(scope: FirewallScope): string {
  switch (scope.kind) {
    case 'dc':
      return '/cluster/firewall'
    case 'node':
      return p`/nodes/${scope.node}/firewall`
    case 'guest':
      return p`/nodes/${scope.node}/${scope.type}/${scope.vmid}/firewall`
    case 'vnet':
      return p`/cluster/sdn/vnets/${scope.vnet}/firewall`
    case 'group':
      return p`/cluster/firewall/groups/${scope.group}`
  }
}

/** The rule list of a scope (a security group's rules live at the group path itself). */
export function rulesPath(scope: FirewallScope): string {
  return scope.kind === 'group' ? firewallBase(scope) : `${firewallBase(scope)}/rules`
}

/** Where source/dest references (aliases, IPSets) are listed for this scope. */
export function refsPath(scope: FirewallScope): string {
  return scope.kind === 'guest' ? `${firewallBase(scope)}/refs` : '/cluster/firewall/refs'
}

/** Query key prefix of everything firewall-related in a scope. */
export function firewallKey(scope: FirewallScope) {
  switch (scope.kind) {
    case 'dc':
      return ['pve', 'cluster', 'firewall'] as const
    case 'node':
      return [...queryKeys.node(scope.node), 'firewall'] as const
    case 'guest':
      return [...queryKeys.guest(scope.node, scope.type, scope.vmid), 'firewall'] as const
    case 'vnet':
      return ['pve', 'cluster', 'sdn', 'vnets', scope.vnet, 'firewall'] as const
    case 'group':
      return ['pve', 'cluster', 'firewall', 'groups', scope.group] as const
  }
}

export const fwKeys = {
  rules: (scope: FirewallScope) => [...firewallKey(scope), 'rules'] as const,
  options: (scope: FirewallScope) => [...firewallKey(scope), 'options'] as const,
  aliases: (scope: FirewallScope) => [...firewallKey(scope), 'aliases'] as const,
  ipsets: (scope: FirewallScope) => [...firewallKey(scope), 'ipset'] as const,
  ipset: (scope: FirewallScope, name: string) => [...firewallKey(scope), 'ipset', name] as const,
  refs: (scope: FirewallScope) => [...firewallKey(scope), 'refs'] as const,
  log: (scope: FirewallScope) => [...firewallKey(scope), 'log'] as const,
  groups: () => ['pve', 'cluster', 'firewall', 'groups'] as const,
  macros: () => ['pve', 'cluster', 'firewall', 'macros'] as const,
}

// ------------------------------------------------------------------ types

export type RuleType = 'in' | 'out' | 'forward' | 'group'
export type LogLevel = 'nolog' | 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug'
export type Policy = 'ACCEPT' | 'REJECT' | 'DROP'

/** One rule as GET …/rules returns it. */
export interface FirewallRule {
  pos: number
  type: RuleType
  /** ACCEPT / DROP / REJECT, or the security group name when type = group. */
  action: string
  enable?: number
  macro?: string
  iface?: string
  proto?: string
  source?: string
  dest?: string
  sport?: string
  dport?: string
  'icmp-type'?: string
  log?: LogLevel
  comment?: string
  ipversion?: number
  digest: string
  /** Parse errors of a rule PVE could not load (field → message). */
  errors?: Record<string, string>
}

export interface SecurityGroup {
  group: string
  comment?: string
  digest: string
}

export interface FirewallAlias {
  name: string
  cidr: string
  comment?: string
  ipversion?: number
  digest: string
}

export interface FirewallIpset {
  name: string
  comment?: string
  digest: string
}

export interface IpsetEntry {
  cidr: string
  nomatch?: number | boolean
  comment?: string
  digest: string
  errors?: Record<string, string>
}

/** GET …/refs: something source/dest may reference. */
export interface FirewallRef {
  type: 'alias' | 'ipset'
  name: string
  /** "+name" for IPSets, "name" for aliases. */
  ref: string
  /** dc, guest or sdn. */
  scope?: string
  comment?: string
}

export interface FirewallMacro {
  macro: string
  descr: string
}

/** Options of any scope: string/number values plus the digest. */
export type FirewallOptions = Record<string, string | number | undefined> & { digest?: string }

export interface LogQuery {
  start: number
  limit: number
  /** Unix seconds. */
  since?: number
  until?: number
}

export interface LogLine {
  n: number
  t: string
}

export interface LogPage {
  lines: LogLine[]
  total: number
}

// ------------------------------------------------------------------ reads

export function useFirewallRules(scope: FirewallScope, enabled = true) {
  return useQuery({
    queryKey: fwKeys.rules(scope),
    queryFn: ({ signal }) => get<FirewallRule[]>(rulesPath(scope), undefined, { signal }),
    enabled,
  })
}

export function useFirewallOptions(scope: FirewallScope, options: { enabled?: boolean; retry?: boolean } = {}) {
  return useQuery({
    queryKey: fwKeys.options(scope),
    queryFn: ({ signal }) => get<FirewallOptions>(`${firewallBase(scope)}/options`, undefined, { signal }),
    enabled: options.enabled ?? true,
    retry: options.retry === false ? false : 1,
    refetchInterval: 30_000,
  })
}

export function useSecurityGroups(enabled = true) {
  return useQuery({
    queryKey: fwKeys.groups(),
    queryFn: ({ signal }) => get<SecurityGroup[]>('/cluster/firewall/groups', undefined, { signal }),
    enabled,
  })
}

export function useFirewallAliases(scope: FirewallScope) {
  return useQuery({
    queryKey: fwKeys.aliases(scope),
    queryFn: ({ signal }) => get<FirewallAlias[]>(`${firewallBase(scope)}/aliases`, undefined, { signal }),
  })
}

export function useFirewallIpsets(scope: FirewallScope) {
  return useQuery({
    queryKey: fwKeys.ipsets(scope),
    queryFn: ({ signal }) => get<FirewallIpset[]>(`${firewallBase(scope)}/ipset`, undefined, { signal }),
  })
}

export function useIpsetEntries(scope: FirewallScope, name: string | undefined) {
  return useQuery({
    queryKey: fwKeys.ipset(scope, name ?? ''),
    queryFn: ({ signal }) => get<IpsetEntry[]>(at(`${firewallBase(scope)}/ipset`, name!), undefined, { signal }),
    enabled: !!name,
  })
}

/** Aliases and IPSets usable in source/dest (type narrows to one kind). */
export function useFirewallRefs(scope: FirewallScope, enabled = true) {
  return useQuery({
    queryKey: fwKeys.refs(scope),
    queryFn: ({ signal }) => get<FirewallRef[]>(refsPath(scope), undefined, { signal }),
    enabled,
    staleTime: 30_000,
  })
}

export function useFirewallMacros(enabled = true) {
  return useQuery({
    queryKey: fwKeys.macros(),
    queryFn: ({ signal }) => get<FirewallMacro[]>('/cluster/firewall/macros', undefined, { signal }),
    enabled,
    staleTime: Infinity,
  })
}

export async function fetchFirewallLog(scope: FirewallScope, q: LogQuery, signal?: AbortSignal): Promise<LogPage> {
  const env = await requestEnvelope<LogLine[]>(
    'GET',
    `${firewallBase(scope)}/log`,
    { start: q.start, limit: q.limit, since: q.since, until: q.until },
    { signal },
  )
  return { lines: env.data ?? [], total: env.total ?? env.data?.length ?? 0 }
}


// ------------------------------------------------------------------ writes

/** Joins a path segment literally into an already-encoded base path. */
function at(base: string, segment: string | number): string {
  return `${base}/${encodeURIComponent(String(segment))}`
}

export const firewallApi = {
  createRule: (scope: FirewallScope, params: Params) => post(rulesPath(scope), params),
  updateRule: (scope: FirewallScope, pos: number, params: Params) => put(at(rulesPath(scope), pos), params),
  /** Move the rule at `pos`; `moveto` uses PVE's "insert before the old index" semantics (see moveToParam). */
  moveRule: (scope: FirewallScope, pos: number, moveto: number) => put(at(rulesPath(scope), pos), { moveto }),
  deleteRule: (scope: FirewallScope, pos: number, digest?: string) => del(at(rulesPath(scope), pos), { digest }),

  setOptions: (scope: FirewallScope, params: Params) => put(`${firewallBase(scope)}/options`, params),

  createGroup: (group: string, comment?: string) => post('/cluster/firewall/groups', { group, comment }),
  /** Rename and/or change the comment (rename = the current name). */
  updateGroup: (current: string, group: string, comment: string, digest?: string) =>
    post('/cluster/firewall/groups', { group, rename: current, comment, digest }),
  deleteGroup: (group: string) => del(at('/cluster/firewall/groups', group)),

  createAlias: (scope: FirewallScope, params: { name: string; cidr: string; comment?: string }) =>
    post(`${firewallBase(scope)}/aliases`, params),
  updateAlias: (scope: FirewallScope, name: string, params: { rename?: string; cidr: string; comment: string; digest?: string }) =>
    put(at(`${firewallBase(scope)}/aliases`, name), params),
  deleteAlias: (scope: FirewallScope, name: string, digest?: string) => del(at(`${firewallBase(scope)}/aliases`, name), { digest }),

  createIpset: (scope: FirewallScope, name: string, comment?: string) => post(`${firewallBase(scope)}/ipset`, { name, comment }),
  updateIpset: (scope: FirewallScope, current: string, name: string, comment: string, digest?: string) =>
    post(`${firewallBase(scope)}/ipset`, { name, rename: current, comment, digest }),
  deleteIpset: (scope: FirewallScope, name: string, force: boolean) =>
    del(at(`${firewallBase(scope)}/ipset`, name), { force: force ? 1 : undefined }),

  addIpsetEntry: (scope: FirewallScope, set: string, params: { cidr: string; nomatch?: boolean; comment?: string }) =>
    post(at(`${firewallBase(scope)}/ipset`, set), { cidr: params.cidr, nomatch: params.nomatch ? 1 : undefined, comment: params.comment }),
  updateIpsetEntry: (scope: FirewallScope, set: string, cidr: string, params: { nomatch: boolean; comment: string; digest?: string }) =>
    put(at(at(`${firewallBase(scope)}/ipset`, set), cidr), { nomatch: params.nomatch ? 1 : 0, comment: params.comment, digest: params.digest }),
  deleteIpsetEntry: (scope: FirewallScope, set: string, cidr: string, digest?: string) =>
    del(at(at(`${firewallBase(scope)}/ipset`, set), cidr), { digest }),
}
