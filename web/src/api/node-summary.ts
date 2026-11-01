// Node summary area (node-summary): status, RRD history, notes, services,
// journal / syslog, package versions, repository and subscription status,
// system report, power commands and Wake-on-LAN.
//
// Endpoints follow pvemanagerlib.js (PVE.node.Summary, PVE.node.StatusView,
// Proxmox.node.ServiceView, Proxmox.panel.JournalView) and the lab's answers.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { get, isPveApiError, p, post, put, requestEnvelope, type Params } from './client'
import { POLL, queryKeys } from './queries'
import type { GuestResource, GuestType, NodeRrdPoint, PveBool, RrdTimeframe } from './types'
import { getSession } from './session'

type QueryOpts<TData, TSelected = TData> = Omit<UseQueryOptions<TData, Error, TSelected>, 'queryKey' | 'queryFn'>

// ------------------------------------------------------------------ types

/** GET /nodes/{node}/status */
export interface NodeStatusDetail {
  /** 0..1 */
  cpu?: number
  /** IO delay, 0..1. */
  wait?: number
  /** ["0.54", "0.49", "0.47"] (strings). */
  loadavg?: (string | number)[]
  uptime?: number
  idle?: number
  cpuinfo?: {
    model?: string
    cores?: number
    cpus?: number
    sockets?: number
    mhz?: string
    vendor?: string
    hvm?: string
    flags?: string
  }
  memory?: { total?: number; used?: number; free?: number; available?: number }
  swap?: { total?: number; used?: number; free?: number }
  rootfs?: { total?: number; used?: number; free?: number; avail?: number }
  ksm?: { shared?: number }
  kversion?: string
  'current-kernel'?: { sysname?: string; release?: string; version?: string; machine?: string }
  'boot-info'?: { mode?: 'efi' | 'legacy-bios' | (string & {}); secureboot?: PveBool }
  pveversion?: string
}

/** GET /nodes/{node}/rrddata, with the fields node charts use. */
export interface NodeRrdSample extends NodeRrdPoint {
  arcsize?: number
  /** Pressure stall (PSI avg10), already in percent. */
  pressurecpusome?: number
  pressurecpufull?: number
  pressureiosome?: number
  pressureiofull?: number
  pressurememorysome?: number
  pressurememoryfull?: number
}

export type RrdCf = 'AVERAGE' | 'MAX'

/** GET /nodes/{node}/config */
export interface NodeConfig {
  description?: string
  digest?: string
  wakeonlan?: string
  'startall-onboot-delay'?: number
  'ballooning-target'?: number
}

/** GET /nodes/{node}/services */
export interface NodeService {
  service: string
  name: string
  desc?: string
  /** "running" | "dead" | … (systemd SubState). */
  state: string
  /** "enabled" | "disabled" | "static" | "masked" | "not-found" | "unknown" */
  'unit-state'?: string
  /** "active" | "inactive" | "failed" | … */
  'active-state'?: string
}

export type ServiceCommand = 'start' | 'stop' | 'restart' | 'reload'

/** GET /nodes/{node}/apt/versions */
export interface AptPackageVersion {
  Package: string
  Title?: string
  Description?: string
  Version?: string
  OldVersion?: string
  CurrentState?: string
  RunningKernel?: string
  ManagerVersion?: string
  Origin?: string
  Arch?: string
  Priority?: string
  Section?: string
}

export interface AptStandardRepo {
  handle: string
  name: string
  description?: string
  /** 1 enabled, 0 configured but disabled, missing = not configured. */
  status?: PveBool
}

/** GET /nodes/{node}/apt/repositories (only what the summary needs). */
export interface AptRepositoriesInfo {
  'standard-repos': AptStandardRepo[]
  digest?: string
  infos?: { index: number; kind: string; message: string; path: string; property?: string }[]
  errors?: { path: string; error: string }[]
}

/** GET /nodes/{node}/subscription */
export interface NodeSubscription {
  status: 'notfound' | 'active' | 'new' | 'invalid' | 'expired' | 'suspended' | (string & {})
  message?: string
  serverid?: string
  level?: string
  productname?: string
  key?: string
  nextduedate?: string
  regdate?: string
  checktime?: number
  url?: string
  sockets?: number
}

/** GET /nodes/{node}/version */
export interface NodeVersion {
  version: string
  release: string
  repoid: string
}

// ------------------------------------------------------------- query keys

export const nodeKeys = {
  status: (node: string) => [...queryKeys.node(node), 'status'] as const,
  rrd: (node: string, timeframe: RrdTimeframe, cf: RrdCf) => [...queryKeys.node(node), 'rrddata', timeframe, cf] as const,
  config: (node: string) => [...queryKeys.node(node), 'config'] as const,
  services: (node: string) => [...queryKeys.node(node), 'services'] as const,
  aptVersions: (node: string) => [...queryKeys.node(node), 'apt', 'versions'] as const,
  repositories: (node: string) => [...queryKeys.node(node), 'apt', 'repositories'] as const,
  subscription: (node: string) => [...queryKeys.node(node), 'subscription'] as const,
  version: (node: string) => [...queryKeys.node(node), 'version'] as const,
  report: (node: string) => [...queryKeys.node(node), 'report'] as const,
}

// ------------------------------------------------------------------ hooks

export function useNodeStatus(node: string, options?: QueryOpts<NodeStatusDetail>) {
  return useQuery({
    queryKey: nodeKeys.status(node),
    queryFn: ({ signal }) => get<NodeStatusDetail>(p`/nodes/${node}/status`, undefined, { signal }),
    refetchInterval: POLL.status,
    ...options,
  })
}

export function useNodeRrdData(
  node: string,
  timeframe: RrdTimeframe,
  cf: RrdCf = 'AVERAGE',
  options?: QueryOpts<NodeRrdSample[]>,
) {
  return useQuery({
    queryKey: nodeKeys.rrd(node, timeframe, cf),
    queryFn: ({ signal }) => get<NodeRrdSample[]>(p`/nodes/${node}/rrddata`, { timeframe, cf }, { signal }),
    refetchInterval: POLL.rrd,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    ...options,
  })
}

export function useNodeConfig(node: string, options?: QueryOpts<NodeConfig>) {
  return useQuery({
    queryKey: nodeKeys.config(node),
    queryFn: ({ signal }) => get<NodeConfig>(p`/nodes/${node}/config`, undefined, { signal }),
    staleTime: 15_000,
    ...options,
  })
}

/** Services, polled every 5 s while shown (the official UI polls every second). */
export function useNodeServices(node: string, options?: QueryOpts<NodeService[]>) {
  return useQuery({
    queryKey: nodeKeys.services(node),
    queryFn: async ({ signal }) => {
      const list = await get<NodeService[]>(p`/nodes/${node}/services`, undefined, { signal })
      return [...list].sort((a, b) => a.name.localeCompare(b.name))
    },
    refetchInterval: 5_000,
    ...options,
  })
}

export function useAptVersions(node: string, options?: QueryOpts<AptPackageVersion[]>) {
  return useQuery({
    queryKey: nodeKeys.aptVersions(node),
    queryFn: ({ signal }) => get<AptPackageVersion[]>(p`/nodes/${node}/apt/versions`, undefined, { signal }),
    staleTime: 60_000,
    ...options,
  })
}

export function useAptRepositories(node: string, options?: QueryOpts<AptRepositoriesInfo>) {
  return useQuery({
    queryKey: nodeKeys.repositories(node),
    queryFn: ({ signal }) => get<AptRepositoriesInfo>(p`/nodes/${node}/apt/repositories`, undefined, { signal }),
    staleTime: 5 * 60_000,
    retry: 1,
    ...options,
  })
}

export function useNodeSubscription(node: string, options?: QueryOpts<NodeSubscription>) {
  return useQuery({
    queryKey: nodeKeys.subscription(node),
    queryFn: ({ signal }) => get<NodeSubscription>(p`/nodes/${node}/subscription`, undefined, { signal }),
    staleTime: 5 * 60_000,
    retry: 1,
    ...options,
  })
}

export function useNodeVersion(node: string, options?: QueryOpts<NodeVersion>) {
  return useQuery({
    queryKey: nodeKeys.version(node),
    queryFn: ({ signal }) => get<NodeVersion>(p`/nodes/${node}/version`, undefined, { signal }),
    staleTime: 10 * 60_000,
    ...options,
  })
}

/** Plain-text system report (tens of KiB, takes a few seconds); load on demand. */
export function useNodeReport(node: string, options?: QueryOpts<string>) {
  return useQuery({
    queryKey: nodeKeys.report(node),
    queryFn: ({ signal }) => get<string>(p`/nodes/${node}/report`, undefined, { signal }),
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
    ...options,
  })
}

// --------------------------------------------------------------- mutations

/** POST /nodes/{node}/status — reboot or shut down the node (returns null). */
export function nodePowerCommand(node: string, command: 'reboot' | 'shutdown') {
  return post(p`/nodes/${node}/status`, { command })
}

/** POST /nodes/{node}/wakeonlan — returns the MAC address the packet was sent to. */
export function wakeOnLan(node: string) {
  return post<string>(p`/nodes/${node}/wakeonlan`)
}

/** POST /nodes/{node}/services/{service}/{command} — returns a UPID. */
export function serviceCommand(node: string, service: string, command: ServiceCommand) {
  return post<string>(p`/nodes/${node}/services/${service}/${command}`)
}

/** PUT /nodes/{node}/config — notes; an empty text deletes the key. */
export function notesUpdateParams(text: string, digest?: string): Params {
  const description = text.replace(/\s+$/, '')
  return description ? { description, digest } : { delete: 'description', digest }
}

export function updateNodeNotes(node: string, text: string, digest?: string) {
  return put(p`/nodes/${node}/config`, notesUpdateParams(text, digest))
}

// ------------------------------------------------------------ permissions

/** True when the session has privilege `priv` on /nodes (unknown caps → allowed, PVE decides). */
export function hasNodePriv(priv: string): boolean {
  const cap = getSession()?.cap
  if (!cap) return true
  return cap.nodes?.[priv] === 1
}

// ---------------------------------------------------------------- display

/** Kernel line like the official UI: "Linux 7.0.2-6-pve (2026-05-20T08:55Z)". */
export function kernelLabel(status: Pick<NodeStatusDetail, 'current-kernel' | 'kversion'>): string | null {
  const k = status['current-kernel']
  if (!k?.release) return status.kversion ?? null
  const build = /\(([^()]+)\)\s*$/.exec(k.version ?? '')?.[1]
  return `${k.sysname ?? 'Linux'} ${k.release}${build ? ` (${build})` : ''}`
}

export function bootModeLabel(boot: NodeStatusDetail['boot-info']): string | null {
  if (!boot?.mode) return null
  if (boot.mode === 'legacy-bios') return 'Legacy BIOS'
  if (boot.mode === 'efi') return boot.secureboot ? 'EFI（安全启动）' : 'EFI'
  return boot.mode
}

/** "8 × Intel(R) Core(TM) i3-N305（1 插槽）" */
export function cpuModelLabel(info: NodeStatusDetail['cpuinfo']): string | null {
  if (!info) return null
  const cpus = info.cpus ?? info.cores
  const model = info.model?.replace(/\s+/g, ' ').trim()
  if (!model && !cpus) return null
  const sockets = info.sockets ? `（${info.sockets} 插槽）` : ''
  return `${cpus ? `${cpus} × ` : ''}${model ?? '未知 CPU'}${sockets}`
}

/** "pve-manager/9.2.2/b9984c6d90a4bd80" → "9.2.2". */
export function managerVersion(pveversion: string | undefined): string | null {
  if (!pveversion) return null
  const m = /^pve-manager\/([^/]+)/.exec(pveversion)
  return m ? m[1]! : pveversion
}

export function parseLoadavg(loadavg: NodeStatusDetail['loadavg']): [number, number, number] | null {
  if (!loadavg || loadavg.length < 3) return null
  const nums = loadavg.slice(0, 3).map(Number)
  return nums.every(Number.isFinite) ? (nums as [number, number, number]) : null
}

/** One line per package, same text as the official "Package versions" window. */
export function formatPackageVersions(list: readonly AptPackageVersion[]): string {
  return list
    .map((rec) => {
      const version = rec.OldVersion && rec.CurrentState === 'Installed' ? rec.OldVersion : 'not correctly installed'
      if (rec.RunningKernel) return `${rec.Package}: ${version} (running kernel: ${rec.RunningKernel})`
      if (rec.ManagerVersion) return `${rec.Package}: ${version} (running version: ${rec.ManagerVersion})`
      return `${rec.Package}: ${version}`
    })
    .join('\n')
}

export interface PackageRow {
  /** Unique within the list (apt can list a package twice, e.g. proxmox-kernel-helper). */
  key: string
  name: string
  /** Installed version, or null when not (correctly) installed. */
  version: string | null
  /** "运行内核 …" / "运行版本 …" */
  note?: string
  /** A newer candidate is available (Version ≠ OldVersion). */
  candidate?: string
}

export function packageRows(list: readonly AptPackageVersion[]): PackageRow[] {
  return list.map((rec, i) => {
    const installed = rec.OldVersion && rec.CurrentState === 'Installed' ? rec.OldVersion : null
    const row: PackageRow = { key: `${i}:${rec.Package}`, name: rec.Package, version: installed }
    if (rec.RunningKernel) row.note = `运行内核 ${rec.RunningKernel}`
    else if (rec.ManagerVersion) row.note = `运行版本 ${rec.ManagerVersion}`
    if (installed && rec.Version && rec.Version !== installed) row.candidate = rec.Version
    return row
  })
}

export type RepoStatus = 'ok' | 'no-sub' | 'non-production' | 'no-repo' | 'unknown'

/** Same decision as Proxmox.widget.NodeInfoRepoStatus. */
export function repoStatus(standardRepos: readonly AptStandardRepo[], subscriptionActive: boolean): RepoStatus {
  const enabled = (handle: string) => standardRepos.find((r) => r.handle === handle)?.status === 1
  const enterprise = enabled('enterprise')
  const noSub = enabled('no-subscription')
  const test = enabled('test')
  if (noSub || test) return 'non-production'
  if (enterprise) return subscriptionActive ? 'ok' : 'no-sub'
  return 'no-repo'
}

export const REPO_STATUS_TEXT: Record<RepoStatus, { tone: 'ok' | 'warn' | 'bad' | 'unknown'; title: string; detail: string }> = {
  ok: { tone: 'ok', title: '可获取更新', detail: '已启用企业版软件源，订阅有效。' },
  'no-sub': { tone: 'warn', title: '企业版软件源需要有效订阅', detail: '已启用企业版软件源，但这台节点没有有效订阅，无法获取更新。' },
  'non-production': {
    tone: 'warn',
    title: '已启用非生产软件源',
    detail: '可以获取更新，但 no-subscription / test 软件源的包未经充分测试，不建议用于生产环境。',
  },
  'no-repo': { tone: 'bad', title: '没有启用 Proxmox VE 软件源', detail: '节点无法获取 Proxmox VE 更新。' },
  unknown: { tone: 'unknown', title: '软件源状态未知', detail: '' },
}

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  active: '有效',
  notfound: '无订阅',
  new: '待激活',
  invalid: '无效',
  expired: '已过期',
  suspended: '已暂停',
}

export const SUBSCRIPTION_LEVEL_LABEL: Record<string, string> = {
  c: 'Community',
  b: 'Basic',
  s: 'Standard',
  p: 'Premium',
}

// --------------------------------------------------------------- services

/** pveproxy, pvedaemon and pve-cluster can only be (re)started, never stopped (official UI). */
export const START_ONLY_SERVICES: ReadonlySet<string> = new Set(['pveproxy', 'pvedaemon', 'pve-cluster'])

/** Restarting these cuts the API connection for a moment. */
export const DISRUPTIVE_SERVICES: ReadonlySet<string> = new Set(['pveproxy', 'pvedaemon', 'pve-cluster', 'corosync'])

/** Not installed / masked / unknown units cannot be controlled. */
export function serviceInstalled(s: Pick<NodeService, 'unit-state'>): boolean {
  return s['unit-state'] !== 'not-found'
}

export function serviceControllable(s: Pick<NodeService, 'unit-state'>): boolean {
  const u = s['unit-state']
  return u !== 'masked' && u !== 'unknown' && u !== 'not-found'
}

/** Commands allowed for a service right now (mirrors ServiceView.set_button_status). */
export function serviceCommands(s: NodeService): ServiceCommand[] {
  if (s.state === 'running') {
    return START_ONLY_SERVICES.has(s.service) ? ['reload', 'restart'] : ['reload', 'restart', 'stop']
  }
  if (!serviceControllable(s)) return []
  return ['start']
}

export const SERVICE_COMMAND_LABEL: Record<ServiceCommand, string> = {
  start: '启动',
  stop: '停止',
  restart: '重启',
  reload: '重新加载',
}

export type ServiceTone = 'ok' | 'off' | 'bad' | 'warn' | 'unknown'

export function serviceState(s: NodeService): { label: string; tone: ServiceTone } {
  const unit = s['unit-state']
  if (unit === 'masked') return { label: '已屏蔽', tone: 'off' }
  if (unit === 'not-found') return { label: '未安装', tone: 'off' }
  if (s['active-state'] === 'failed') return { label: '失败', tone: 'bad' }
  if (s.state === 'running') return { label: '运行中', tone: 'ok' }
  if (s['active-state'] === 'activating' || s['active-state'] === 'reloading') return { label: '启动中', tone: 'warn' }
  if (s.state === 'dead' || s['active-state'] === 'inactive') return { label: '已停止', tone: 'off' }
  return { label: s.state || '未知', tone: 'unknown' }
}

export const UNIT_STATE_LABEL: Record<string, string> = {
  enabled: '开机自启',
  disabled: '不自启',
  static: '静态',
  masked: '已屏蔽',
  'not-found': '未安装',
  unknown: '未知',
  generated: '自动生成',
  indirect: '间接',
}

// ---------------------------------------------------------------- journal

/** One journal line, from the structured (PVE ≥ 9.2.x) or the plain text format. */
export interface JournalLine {
  /** Stable key within one view. */
  key: string
  /** Microseconds since the epoch (structured only). */
  time?: number
  identifier?: string
  pid?: number
  /** Syslog priority 0 (emerg) … 7 (debug); structured only. */
  priority?: number
  message: string
  /** Pre-rendered text (plain format) or null for structured entries. */
  text?: string
  reboot?: boolean
}

export interface JournalChunk {
  lines: JournalLine[]
  /** Cursor of the first entry: pass as `endcursor` to load older entries. */
  firstCursor?: string
  /** Cursor of the last entry: pass as `startcursor` to follow. */
  lastCursor?: string
  host?: string
  identifiers?: string[]
  units?: string[]
  structured: boolean
}

interface StructuredRecord {
  ty?: string
  c?: string
  h?: string
  ids?: string[]
  names?: string[]
  id?: string
  msg?: string
  p?: number
  pid?: number
  t?: number
}

let lineSeq = 0

/**
 * Parse GET /nodes/{node}/journal. Plain text: first and last element are
 * cursors, the rest rendered lines. Structured: typed records (cursor, host,
 * identifiers, units, reboot) and entries {t, id, pid, p, msg}.
 */
export function parseJournal(data: readonly unknown[]): JournalChunk {
  if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    const out: JournalChunk = { lines: [], structured: true }
    for (const raw of data as StructuredRecord[]) {
      switch (raw.ty) {
        case 'cursor':
          if (out.firstCursor === undefined) out.firstCursor = raw.c
          out.lastCursor = raw.c
          break
        case 'host':
          out.host = raw.h
          break
        case 'identifiers':
          out.identifiers = raw.ids ?? []
          break
        case 'units':
          out.units = raw.names ?? []
          break
        case 'reboot':
          out.lines.push({ key: `r${lineSeq++}`, time: raw.t, message: '-- 重新启动 --', reboot: true })
          break
        default:
          out.lines.push({
            key: `s${lineSeq++}`,
            time: raw.t,
            identifier: raw.id,
            pid: raw.pid,
            priority: raw.p,
            message: raw.msg ?? '',
          })
      }
    }
    return out
  }
  const strings = data.filter((x): x is string => typeof x === 'string')
  if (strings.length === 0) return { lines: [], structured: false }
  const firstCursor = strings[0]
  const lastCursor = strings.length > 1 ? strings[strings.length - 1] : strings[0]
  const body = strings.slice(1, -1)
  return {
    lines: body.map((t) => ({ key: `p${lineSeq++}`, message: t, text: t, reboot: /^-- (Reboot|Boot) /.test(t) })),
    firstCursor,
    lastCursor,
    structured: false,
  }
}

export interface JournalFilters {
  /** "0".."7" — that level and everything more severe; "" = all. */
  priority?: string
  /** Syslog identifier glob, e.g. "pve*". */
  service?: string
  /** systemd unit (".service" implied). */
  unit?: string
  kernel?: boolean
}

export type JournalRequest =
  | { mode: 'tail'; lastentries: number }
  | { mode: 'follow'; startcursor: string }
  | { mode: 'older'; endcursor: string; lastentries: number }
  | { mode: 'range'; since: number; until: number }

/** Build the query for GET /nodes/{node}/journal (filters only when structured is supported). */
export function journalParams(req: JournalRequest, filters: JournalFilters, structured: boolean, withLists = false): Params {
  const params: Params = {}
  switch (req.mode) {
    case 'tail':
      params.lastentries = req.lastentries
      break
    case 'follow':
      params.startcursor = req.startcursor
      break
    case 'older':
      params.endcursor = req.endcursor
      params.lastentries = req.lastentries
      break
    case 'range':
      params.since = req.since
      params.until = req.until
      break
  }
  if (!structured) return params
  params.structured = 1
  if (withLists) {
    params.identifiers = 1
    params.units = 1
  }
  if (filters.priority) params.priority = filters.priority
  if (filters.kernel) {
    params.kernel = 1
  } else {
    if (filters.service?.trim()) params.service = filters.service.trim()
    if (filters.unit?.trim()) params.unit = filters.unit.trim().replace(/\.service$/, '')
  }
  return params
}

/** Whether a node's journal endpoint knows `structured` (PVE 9.2.x+); learnt on the first request. */
const structuredSupport = new Map<string, boolean>()

export function journalSupportsStructured(node: string): boolean | undefined {
  return structuredSupport.get(node)
}

function isUnknownParamError(e: unknown): boolean {
  return isPveApiError(e) && e.status === 400 && !!e.errors && 'structured' in e.errors
}

/**
 * Read the journal. Tries the structured format first (priority colours,
 * filters); falls back to plain lines on older PVE and remembers that.
 */
export async function fetchJournal(
  node: string,
  req: JournalRequest,
  filters: JournalFilters = {},
  opts: { withLists?: boolean; signal?: AbortSignal } = {},
): Promise<JournalChunk> {
  const path = p`/nodes/${node}/journal`
  const structured = structuredSupport.get(node) ?? true
  try {
    const data = await get<unknown[]>(path, journalParams(req, filters, structured, opts.withLists), { signal: opts.signal })
    if (structured) structuredSupport.set(node, true)
    return parseJournal(data ?? [])
  } catch (e) {
    if (structured && isUnknownParamError(e)) {
      structuredSupport.set(node, false)
      const data = await get<unknown[]>(path, journalParams(req, filters, false), { signal: opts.signal })
      return parseJournal(data ?? [])
    }
    throw e
  }
}

/**
 * Last `limit` syslog lines of one service (GET /nodes/{node}/syslog?service=),
 * for PVE versions whose journal endpoint has no unit filter.
 */
export async function fetchServiceSyslog(node: string, service: string, limit = 500, signal?: AbortSignal): Promise<JournalLine[]> {
  const path = p`/nodes/${node}/syslog`
  const head = await requestEnvelope<{ n: number; t: string }[]>('GET', path, { service, start: 0, limit: 1 }, { signal })
  const total = head.total ?? head.data.length
  const start = Math.max(0, total - limit)
  const rows = start === 0 && total <= 1 ? head.data : await get<{ n: number; t: string }[]>(path, { service, start, limit }, { signal })
  return rows
    .filter((r) => r.t !== 'no content')
    .map((r) => ({ key: `l${r.n}`, message: r.t, text: r.t }))
}

export const PRIORITY_LABEL: Record<string, string> = {
  '0': '紧急',
  '1': '警报',
  '2': '严重',
  '3': '错误',
  '4': '警告',
  '5': '注意',
  '6': '信息',
  '7': '调试',
}

/** "Nov 01 04:04:24" style timestamp (local time) for structured entries. */
export function formatJournalTime(micros: number | undefined): string {
  if (micros === undefined || !Number.isFinite(micros)) return ''
  const d = new Date(micros / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** A line as plain text (for copy / download). */
export function journalLineText(l: JournalLine, host?: string): string {
  if (l.text !== undefined) return l.text
  if (l.reboot) return `${formatJournalTime(l.time)} -- Reboot --`
  const pid = l.pid !== undefined ? `[${l.pid}]` : ''
  return `${formatJournalTime(l.time)} ${host ? `${host} ` : ''}${l.identifier ?? ''}${pid}: ${l.message}`
}

// ------------------------------------------------------------ node guests

/** One entry of GET /nodes/{node}/qemu?full=1 or GET /nodes/{node}/lxc (fields the list uses). */
export interface NodeGuestEntry {
  vmid: number | string
  name?: string
  status: string
  /** QEMU: the real run state (running, paused, prelaunch, suspended …). */
  qmpstatus?: string
  template?: PveBool
  lock?: string
  tags?: string
  cpu?: number
  cpus?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
}

/**
 * Per-node guest index (overview/guest-index) as /cluster/resources-shaped
 * rows, so the overview's list and filters work on it. QEMU's "running" is
 * refined with qmpstatus (paused / prelaunch / suspended), the way the
 * cluster resources report it.
 */
export function nodeGuestRows(node: string, qemu: readonly NodeGuestEntry[], lxc: readonly NodeGuestEntry[]): GuestResource[] {
  const row = (type: GuestType, g: NodeGuestEntry): GuestResource => {
    const vmid = Number(g.vmid)
    const status = type === 'qemu' && g.status === 'running' && g.qmpstatus && g.qmpstatus !== 'running' ? g.qmpstatus : g.status
    const out: GuestResource = { id: `${type}/${vmid}`, type, vmid, node, status }
    if (g.name !== undefined) out.name = g.name
    if (Number(g.template) === 1) out.template = 1
    if (g.lock) out.lock = g.lock
    if (g.tags) out.tags = g.tags
    if (g.cpu !== undefined) out.cpu = g.cpu
    if (g.cpus !== undefined) out.maxcpu = g.cpus
    if (g.mem !== undefined) out.mem = g.mem
    if (g.maxmem !== undefined) out.maxmem = g.maxmem
    if (g.disk !== undefined) out.disk = g.disk
    if (g.maxdisk !== undefined) out.maxdisk = g.maxdisk
    if (g.uptime !== undefined) out.uptime = g.uptime
    return out
  }
  return [...qemu.map((g) => row('qemu', g)), ...lxc.map((g) => row('lxc', g))].sort((a, b) => a.vmid - b.vmid)
}

/** VMs and CTs of one node (GET /nodes/{node}/qemu?full=1 + /nodes/{node}/lxc), polled like the resources. */
export function useNodeGuests(node: string, options?: QueryOpts<GuestResource[]>) {
  return useQuery({
    queryKey: [...queryKeys.node(node), 'guests'],
    queryFn: async ({ signal }) => {
      const [qemu, lxc] = await Promise.all([
        get<NodeGuestEntry[]>(p`/nodes/${node}/qemu`, { full: 1 }, { signal }),
        get<NodeGuestEntry[]>(p`/nodes/${node}/lxc`, undefined, { signal }),
      ])
      return nodeGuestRows(node, qemu, lxc)
    },
    refetchInterval: POLL.resources,
    ...options,
  })
}
