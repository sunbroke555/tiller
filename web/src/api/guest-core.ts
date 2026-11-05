// API of the guest summary and power area (guest-summary-power):
// status/current, rrddata, guest agent / CT interfaces, config (notes and
// tags), cluster options (tag style) and the power commands.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { get, p, post, put, type Params } from './client'
import { POLL, queryKeys } from './queries'
import type { GuestType, PveBool, RrdTimeframe } from './types'

// ------------------------------------------------------------------- types

/** HA part of status/current. */
export interface GuestHaStatus {
  managed: PveBool
  state?: string
  group?: string
  request?: string
}

/** GET /nodes/{node}/{qemu|lxc}/{vmid}/status/current (fields of both types). */
export interface GuestStatusCurrent {
  vmid: number
  name?: string
  status: 'running' | 'stopped' | (string & {})
  /** QEMU: running, paused, suspended, prelaunch, shutdown, … */
  qmpstatus?: string
  cpu?: number
  cpus?: number
  mem?: number
  maxmem?: number
  memhost?: number
  balloon?: number
  ballooninfo?: { actual?: number; max_mem?: number; free_mem?: number; total_mem?: number }
  maxdisk?: number
  disk?: number
  swap?: number
  maxswap?: number
  netin?: number
  netout?: number
  diskread?: number
  diskwrite?: number
  uptime?: number
  pid?: number
  ha?: GuestHaStatus
  lock?: string
  tags?: string
  template?: PveBool | ''
  /** QEMU: 1 when the guest agent is enabled in the config. */
  agent?: PveBool
  'running-machine'?: string
  'running-qemu'?: string
  spice?: PveBool
  serial?: PveBool
  /** LXC: "lxc". */
  type?: string
  pressurecpusome?: number | string
  pressurecpufull?: number | string
  pressureiosome?: number | string
  pressureiofull?: number | string
  pressurememorysome?: number | string
  pressurememoryfull?: number | string
}

/** GET .../rrddata: one sample; every field may be missing (gaps). */
export interface GuestRrdPoint {
  time: number
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  memhost?: number
  disk?: number
  maxdisk?: number
  diskread?: number
  diskwrite?: number
  netin?: number
  netout?: number
  pressurecpusome?: number
  pressurecpufull?: number
  pressureiosome?: number
  pressureiofull?: number
  pressurememorysome?: number
  pressurememoryfull?: number
}

export type RrdCf = 'AVERAGE' | 'MAX'

/** Guest config as returned by GET .../config (only the keys this area reads are typed). */
export interface GuestConfig {
  digest?: string
  name?: string
  hostname?: string
  description?: string
  tags?: string
  template?: PveBool
  protection?: PveBool
  agent?: string
  ostype?: string
  cores?: number
  sockets?: number
  memory?: number | string
  swap?: number
  unprivileged?: PveBool
  lock?: string
  [key: string]: string | number | undefined
}

/** GET .../agent/network-get-interfaces → result[] */
export interface AgentNetworkInterface {
  name: string
  'hardware-address'?: string
  'ip-addresses'?: { 'ip-address': string; 'ip-address-type': 'ipv4' | 'ipv6' | (string & {}); prefix?: number }[]
}

/** GET /nodes/{node}/lxc/{vmid}/interfaces */
export interface LxcInterface {
  name: string
  hwaddr?: string
  'hardware-address'?: string
  inet?: string
  inet6?: string
  'ip-addresses'?: { 'ip-address': string; 'ip-address-type': string; prefix?: string | number }[]
}

/** GET .../agent/get-osinfo → result */
export interface AgentOsInfo {
  name?: string
  'pretty-name'?: string
  version?: string
  'version-id'?: string
  'kernel-release'?: string
  'kernel-version'?: string
  machine?: string
  id?: string
}

/** GET .../agent/get-load → result (qemu-server ≥ 9.2.14, Linux guests). */
export interface AgentLoad {
  load1?: number
  load5?: number
  load15?: number
}

/** GET .../agent/get-cpustats → result[]: cumulative counters in USER_HZ ticks. */
export interface AgentCpuStat {
  type?: 'linux' | (string & {})
  cpu?: number
  user?: number
  nice?: number
  system?: number
  idle?: number
  iowait?: number
  irq?: number
  softirq?: number
  steal?: number
  guest?: number
  guestnice?: number
}

/** GET .../agent/get-diskstats → result[]: cumulative /proc/diskstats counters. */
export interface AgentDiskStat {
  name: string
  major?: number
  minor?: number
  /** read-sectors, read-ios, write-sectors, write-ios, flush-ios, …; all optional. */
  stats?: Record<string, number | undefined>
}

/** GET .../agent/get-disks → result[] */
export interface AgentDisk {
  /** Device path, e.g. "/dev/sda". */
  name: string
  partition?: boolean
  /** Devices this one sits on (the disk of a partition, the PVs of an LV). */
  dependencies?: string[]
  address?: {
    'bus-type'?: string
    serial?: string
    dev?: string
    bus?: number
    target?: number
    unit?: number
    [key: string]: unknown
  }
  /** Device-mapper name, e.g. "ubuntu--vg-root". */
  alias?: string
  /** NVMe SMART data; temperature in kelvin. */
  smart?: { type?: string; temperature?: number; [key: string]: unknown }
}

/** A cumulative-counter result with the time it arrived, for rate computation. */
export interface AgentSample<T> {
  /** Date.now() when the response arrived. */
  at: number
  data: T
}

/** GET /cluster/options (only the keys this area reads). */
export interface ClusterOptions {
  'tag-style'?: string | Record<string, string>
  'user-tag-access'?: string | Record<string, string | string[]>
  'registered-tags'?: string | string[]
  'allowed-tags'?: string[]
  [key: string]: unknown
}

// ------------------------------------------------------------------- paths

export const guestBase = (node: string, type: GuestType, vmid: number) => p`/nodes/${node}/${type}/${vmid}`

type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T>, 'queryKey' | 'queryFn'>

// ------------------------------------------------------------------- hooks

export const guestCoreKeys = {
  status: (node: string, type: GuestType, vmid: number) => [...queryKeys.guest(node, type, vmid), 'status'] as const,
  config: (node: string, type: GuestType, vmid: number) => [...queryKeys.guest(node, type, vmid), 'config'] as const,
  rrd: (node: string, type: GuestType, vmid: number, timeframe: RrdTimeframe, cf: RrdCf) =>
    [...queryKeys.guest(node, type, vmid), 'rrddata', timeframe, cf] as const,
  ips: (node: string, type: GuestType, vmid: number) => [...queryKeys.guest(node, type, vmid), 'ips'] as const,
  osinfo: (node: string, vmid: number) => [...queryKeys.guest(node, 'qemu', vmid), 'agent', 'osinfo'] as const,
  hostname: (node: string, vmid: number) => [...queryKeys.guest(node, 'qemu', vmid), 'agent', 'hostname'] as const,
  agentLoad: (node: string, vmid: number) => [...queryKeys.guest(node, 'qemu', vmid), 'agent', 'load'] as const,
  agentCpuStats: (node: string, vmid: number) => [...queryKeys.guest(node, 'qemu', vmid), 'agent', 'cpustats'] as const,
  agentDiskStats: (node: string, vmid: number) => [...queryKeys.guest(node, 'qemu', vmid), 'agent', 'diskstats'] as const,
  agentDisks: (node: string, vmid: number) => [...queryKeys.guest(node, 'qemu', vmid), 'agent', 'disks'] as const,
  clusterOptions: () => ['pve', 'cluster', 'options'] as const,
}

/** Live status of one guest, polled every 5 s while visible. */
export function useGuestStatus(node: string, type: GuestType, vmid: number, options?: QueryOpts<GuestStatusCurrent>) {
  return useQuery({
    queryKey: guestCoreKeys.status(node, type, vmid),
    queryFn: ({ signal }) => get<GuestStatusCurrent>(`${guestBase(node, type, vmid)}/status/current`, undefined, { signal }),
    refetchInterval: 5_000,
    ...options,
  })
}

/** Current guest config (GET .../config). */
export function useGuestConfig(node: string, type: GuestType, vmid: number, options?: QueryOpts<GuestConfig>) {
  return useQuery({
    queryKey: guestCoreKeys.config(node, type, vmid),
    queryFn: ({ signal }) => get<GuestConfig>(`${guestBase(node, type, vmid)}/config`, undefined, { signal }),
    staleTime: 5_000,
    ...options,
  })
}

/** RRD history of one guest. */
export function useGuestRrd(
  node: string,
  type: GuestType,
  vmid: number,
  timeframe: RrdTimeframe,
  cf: RrdCf = 'AVERAGE',
  options?: QueryOpts<GuestRrdPoint[]>,
) {
  return useQuery({
    queryKey: guestCoreKeys.rrd(node, type, vmid, timeframe, cf),
    queryFn: ({ signal }) =>
      get<GuestRrdPoint[]>(`${guestBase(node, type, vmid)}/rrddata`, { timeframe, cf }, { signal }),
    refetchInterval: timeframe === 'hour' ? 60_000 : 5 * 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    ...options,
  })
}

/**
 * Raw interface list: guest agent network-get-interfaces (QEMU, fails with
 * 500 when the agent is off or not running) or /lxc/{vmid}/interfaces.
 */
export function useGuestInterfaces(
  node: string,
  type: GuestType,
  vmid: number,
  options?: QueryOpts<AgentNetworkInterface[] | LxcInterface[]>,
) {
  return useQuery({
    queryKey: guestCoreKeys.ips(node, type, vmid),
    queryFn: async ({ signal }) => {
      if (type === 'lxc') return get<LxcInterface[]>(p`/nodes/${node}/lxc/${vmid}/interfaces`, undefined, { signal })
      const res = await get<{ result?: AgentNetworkInterface[] }>(
        p`/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`,
        undefined,
        { signal },
      )
      return res?.result ?? []
    },
    refetchInterval: 30_000,
    retry: false,
    ...options,
  })
}

/** Guest agent OS information (QEMU). */
export function useAgentOsInfo(node: string, vmid: number, options?: QueryOpts<AgentOsInfo | null>) {
  return useQuery({
    queryKey: guestCoreKeys.osinfo(node, vmid),
    queryFn: async ({ signal }) =>
      (await get<{ result?: AgentOsInfo }>(p`/nodes/${node}/qemu/${vmid}/agent/get-osinfo`, undefined, { signal }))?.result ?? null,
    staleTime: 5 * 60_000,
    retry: false,
    ...options,
  })
}

/** Guest agent host name (QEMU). */
export function useAgentHostname(node: string, vmid: number, options?: QueryOpts<string | null>) {
  return useQuery({
    queryKey: guestCoreKeys.hostname(node, vmid),
    queryFn: async ({ signal }) =>
      (await get<{ result?: { 'host-name'?: string } }>(p`/nodes/${node}/qemu/${vmid}/agent/get-host-name`, undefined, { signal }))
        ?.result?.['host-name'] ?? null,
    staleTime: 5 * 60_000,
    retry: false,
    ...options,
  })
}

// Guest agent statistics (qemu-server ≥ 9.2.14). Most agents only implement
// them for Linux; Windows, old agents and old PVE answer 500 / 501. A query
// that has never succeeded stops polling after its first error, so an
// unsupported command is asked once (again on window focus or when the agent
// comes back), not every interval.

/** Poll while the command works; stop after an error that never had data. */
function agentStatsInterval(query: { state: { status: string; data: unknown } }) {
  return query.state.status === 'error' && query.state.data === undefined ? false : POLL.status
}

async function agentResult<T>(node: string, vmid: number, command: string, signal: AbortSignal): Promise<T | null> {
  const res = await get<{ result?: T }>(p`/nodes/${node}/qemu/${vmid}/agent/${command}`, undefined, { signal })
  return res?.result ?? null
}

async function agentSample<T>(node: string, vmid: number, command: string, signal: AbortSignal): Promise<AgentSample<T | null>> {
  const data = await agentResult<T>(node, vmid, command, signal)
  return { at: Date.now(), data }
}

/** Guest load averages (agent get-load). */
export function useAgentLoad(node: string, vmid: number, options?: QueryOpts<AgentLoad | null>) {
  return useQuery({
    queryKey: guestCoreKeys.agentLoad(node, vmid),
    queryFn: ({ signal }) => agentResult<AgentLoad>(node, vmid, 'get-load', signal),
    refetchInterval: agentStatsInterval,
    retry: false,
    ...options,
  })
}

/** Per-CPU cumulative counters with their arrival time (agent get-cpustats). */
export function useAgentCpuStats(node: string, vmid: number, options?: QueryOpts<AgentSample<AgentCpuStat[] | null>>) {
  return useQuery({
    queryKey: guestCoreKeys.agentCpuStats(node, vmid),
    queryFn: ({ signal }) => agentSample<AgentCpuStat[]>(node, vmid, 'get-cpustats', signal),
    refetchInterval: agentStatsInterval,
    retry: false,
    ...options,
  })
}

/** Per-disk cumulative IO counters with their arrival time (agent get-diskstats). */
export function useAgentDiskStats(node: string, vmid: number, options?: QueryOpts<AgentSample<AgentDiskStat[] | null>>) {
  return useQuery({
    queryKey: guestCoreKeys.agentDiskStats(node, vmid),
    queryFn: ({ signal }) => agentSample<AgentDiskStat[]>(node, vmid, 'get-diskstats', signal),
    refetchInterval: agentStatsInterval,
    retry: false,
    ...options,
  })
}

/** Guest disk and partition inventory (agent get-disks); rarely changes. */
export function useAgentDisks(node: string, vmid: number, options?: QueryOpts<AgentDisk[] | null>) {
  return useQuery({
    queryKey: guestCoreKeys.agentDisks(node, vmid),
    queryFn: ({ signal }) => agentResult<AgentDisk[]>(node, vmid, 'get-disks', signal),
    staleTime: 5 * 60_000,
    retry: false,
    ...options,
  })
}

/** Datacenter options (tag style, tag access). */
export function useClusterOptions(options?: QueryOpts<ClusterOptions>) {
  return useQuery({
    queryKey: guestCoreKeys.clusterOptions(),
    queryFn: ({ signal }) => get<ClusterOptions>('/cluster/options', undefined, { signal }),
    staleTime: 5 * 60_000,
    retry: 1,
    ...options,
  })
}

// --------------------------------------------------------------- commands

export type PowerCommand = 'start' | 'shutdown' | 'stop' | 'reboot' | 'reset' | 'suspend' | 'resume'

/** POST .../status/{command}; returns a UPID. */
export function powerCommand(node: string, type: GuestType, vmid: number, command: PowerCommand, params?: Params) {
  return post<string>(`${guestBase(node, type, vmid)}/status/${command}`, params)
}

/** PUT .../config (synchronous). */
export function updateGuestConfig(node: string, type: GuestType, vmid: number, params: Params) {
  return put<null>(`${guestBase(node, type, vmid)}/config`, params)
}
