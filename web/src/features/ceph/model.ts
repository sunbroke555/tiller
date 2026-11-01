// Pure Ceph logic: health checks, PG state categories, OSD tree, services,
// versions, install options and form → API params. Rules follow the official
// UI (pvemanagerlib.js: PVE.node.CephStatus, PVE.ceph.StatusDetail,
// PVE.ceph.Services, PVE.node.CephOsdTree, PVE.CephPoolInputPanel,
// PVE.CephCreateOsd, PVE.ceph.CephInstallWizard).

import type {
  CephFlag,
  CephHealthCheck,
  CephHealthStatus,
  CephMetadata,
  CephOsdTree,
  CephOsdTreeNode,
  CephPgState,
  CephPoolStatus,
  CephStatus,
  PgAutoscaleMode,
  PoolApplication,
} from '@/api/ceph'
import type { Params } from '@/api/client'

// ----------------------------------------------------------------- health

export type HealthTone = 'ok' | 'warn' | 'err' | 'unknown'

export function healthTone(status: CephHealthStatus | undefined): HealthTone {
  switch (status) {
    case 'HEALTH_OK':
      return 'ok'
    case 'HEALTH_WARN':
      return 'warn'
    case 'HEALTH_ERR':
      return 'err'
    default:
      return 'unknown'
  }
}

export const HEALTH_LABEL: Record<HealthTone, string> = {
  ok: '健康',
  warn: '警告',
  err: '错误',
  unknown: '未知',
}

export interface HealthCheckRow {
  /** Check code, e.g. OSD_DOWN. */
  id: string
  tone: HealthTone
  severity: string
  summary: string
  /** Detail lines (may be empty). */
  detail: string[]
  muted: boolean
}

const SEVERITY_ORDER: Record<HealthTone, number> = { err: 0, warn: 1, unknown: 2, ok: 3 }

/** Health checks, worst first, then by code (official warnings grid). */
export function healthChecks(health: { checks?: Record<string, CephHealthCheck> } | undefined): HealthCheckRow[] {
  return Object.entries(health?.checks ?? {})
    .map(([id, c]) => ({
      id,
      tone: healthTone(c.severity),
      severity: c.severity,
      summary: c.summary?.message ?? id,
      detail: (c.detail ?? []).map((d) => d.message).filter(Boolean),
      muted: !!c.muted,
    }))
    .sort((a, b) => SEVERITY_ORDER[a.tone] - SEVERITY_ORDER[b.tone] || a.id.localeCompare(b.id))
}

/** "HEALTH_WARN: summary\ndetail…" for the clipboard. */
export function healthCheckText(c: HealthCheckRow): string {
  return [`${c.severity}: ${c.summary}`, ...c.detail].join('\n')
}

// ------------------------------------------------------------- PG states

export type PgCategory = 'unknown' | 'clean' | 'busy' | 'warning' | 'critical'

/** Severity of each PG state word (like the official status / mgr dashboard). */
const PG_STATE_LEVEL: Record<string, number> = {
  clean: 1,
  active: 1,
  activating: 2,
  backfill_wait: 2,
  backfilling: 2,
  creating: 2,
  deep: 2,
  forced_backfill: 2,
  forced_recovery: 2,
  peered: 2,
  peering: 2,
  recovering: 2,
  recovery_wait: 2,
  remapped: 2,
  repair: 2,
  scrubbing: 2,
  snaptrim: 2,
  snaptrim_wait: 2,
  degraded: 3,
  undersized: 3,
  backfill_toofull: 4,
  backfill_unfound: 4,
  down: 4,
  incomplete: 4,
  inconsistent: 4,
  recovery_toofull: 4,
  recovery_unfound: 4,
  snaptrim_error: 4,
  stale: 4,
}

const PG_CATEGORIES: PgCategory[] = ['unknown', 'clean', 'busy', 'warning', 'critical']

export const PG_CATEGORY_LABEL: Record<PgCategory, string> = {
  unknown: '未知',
  clean: '正常',
  busy: '处理中',
  warning: '警告',
  critical: '严重',
}

/** "active+undersized+degraded" → its worst word's category. */
export function pgCategory(stateName: string): PgCategory {
  let level = 0
  for (const word of stateName.split(/[^a-z_]+/)) {
    const l = PG_STATE_LEVEL[word] ?? 0
    if (l > level) level = l
  }
  return PG_CATEGORIES[level]!
}

export interface PgSummary {
  total: number
  categories: { category: PgCategory; count: number }[]
  /** Every state, sorted by name, with its category. */
  states: (CephPgState & { category: PgCategory })[]
}

export function pgSummary(pgsByState: readonly CephPgState[] | undefined): PgSummary {
  const counts = new Map<PgCategory, number>(PG_CATEGORIES.map((c) => [c, 0]))
  const states = [...(pgsByState ?? [])]
    .sort((a, b) => a.state_name.localeCompare(b.state_name))
    .map((s) => ({ ...s, category: pgCategory(s.state_name) }))
  let total = 0
  for (const s of states) {
    counts.set(s.category, (counts.get(s.category) ?? 0) + s.count)
    total += s.count
  }
  return { total, categories: PG_CATEGORIES.map((category) => ({ category, count: counts.get(category) ?? 0 })), states }
}

// ------------------------------------------------------------- OSD counts

export interface OsdCounts {
  total: number
  upIn: number
  upOut: number
  downIn: number
  downOut: number
}

/** Up/in matrix from the OSD map and the OSD_DOWN check (official StatusDetail). */
export function osdCounts(status: Pick<CephStatus, 'osdmap' | 'health'> | undefined): OsdCounts {
  const raw = (status?.osdmap ?? {}) as NonNullable<CephStatus['osdmap']> & { osdmap?: CephStatus['osdmap'] }
  const map = raw.osdmap ?? raw
  const total = map.num_osds ?? 0
  const inn = map.num_in_osds ?? 0
  const up = map.num_up_osds ?? 0
  const m = status?.health?.checks?.OSD_DOWN?.summary?.message?.match(/(\d+) osds? down/)
  const downIn = m ? Number(m[1]) : 0
  const down = total - up
  const upIn = inn - downIn
  return { total, upIn, upOut: up - upIn, downIn, downOut: down - downIn }
}

// ---------------------------------------------------------------- recovery

export interface RecoveryInfo {
  /** 0..1 */
  ratio: number
  /** Bytes per second. */
  speed: number
  /** Seconds left (4 MiB objects at the current speed), when moving. */
  eta: number | null
}

/** Recovery / rebalance progress (official CephStatus.updateAll). */
export function recoveryInfo(pgmap: CephStatus['pgmap'] | undefined): RecoveryInfo | null {
  if (!pgmap) return null
  const unhealthy = (pgmap.degraded_objects ?? 0) + (pgmap.unfound_objects ?? 0) + (pgmap.misplaced_objects ?? 0)
  if (pgmap.recovering_objects_per_sec === undefined && unhealthy === 0) return null
  const total = pgmap.misplaced_total || pgmap.unfound_total || pgmap.degraded_total || 0
  if (!total) return null
  const ratio = Math.min(Math.max((total - unhealthy) / total, 0), 1)
  const speed = pgmap.recovering_bytes_per_sec ?? 0
  const objPerSec = speed / (4 * 1024 * 1024)
  return { ratio, speed, eta: objPerSec > 0 ? unhealthy / objPerSec : null }
}

// ---------------------------------------------------------------- versions

/** "19.2.6" from ceph_version_short or "ceph version 19.2.6 (…) squid (stable)". */
export function parseCephVersion(d: { ceph_version_short?: string | undefined; ceph_version?: string | undefined } | undefined): string | undefined {
  if (!d) return undefined
  if (d.ceph_version_short) return d.ceph_version_short
  const m = d.ceph_version?.match(/^ceph.*\sv?(\d+(?:\.\d+)+)/)
  return m?.[1]
}

/** Numeric comparison of dotted versions (or arrays of parts). */
export function compareCephVersions(a: string | readonly string[] | undefined, b: string | readonly string[] | undefined): number {
  const av = (Array.isArray(a) ? [...a] : String(a ?? '').split('.')).filter((x) => x !== '')
  const bv = (Array.isArray(b) ? [...b] : String(b ?? '').split('.')).filter((x) => x !== '')
  for (let i = 0; ; i++) {
    const x = av[i]
    const y = bv[i]
    if (x === undefined && y === undefined) return 0
    if (x === undefined) return -1
    if (y === undefined) return 1
    const d = parseInt(x, 10) - parseInt(y, 10)
    if (d !== 0) return d
  }
}

/** Highest Ceph version installed on any node ("19.2.6"), if known. */
export function newestNodeVersion(metadata: Pick<CephMetadata, 'node'> | undefined): string | undefined {
  let best: string | undefined
  for (const n of Object.values(metadata?.node ?? {})) {
    const v = n?.version?.str ?? n?.version?.parts?.join('.')
    if (v && (!best || compareCephVersions(v, best) > 0)) best = v
  }
  return best
}

// ----------------------------------------------------------------- install

export interface CephRelease {
  release: string
  version: string
  /** Technology preview: no enterprise repository yet. */
  preview?: boolean
}

/** Releases the official wizard offers (PVE.ceph.CephVersionSelector). */
export const CEPH_RELEASES: CephRelease[] = [
  { release: 'squid', version: '19.2' },
  { release: 'tentacle', version: '20.2' },
]

const MAJOR_RELEASE: Record<number, string> = { 17: 'quincy', 18: 'reef', 19: 'squid', 20: 'tentacle' }

export function releaseOfVersion(version: string | undefined): string | undefined {
  const major = Number(String(version ?? '').split('.')[0])
  return MAJOR_RELEASE[major]
}

/** Release to preselect: the one already running in the cluster, else the newest offered. */
export function defaultRelease(clusterVersion: string | undefined): string {
  const r = releaseOfVersion(clusterVersion)
  if (r && CEPH_RELEASES.some((x) => x.release === r)) return r
  return CEPH_RELEASES[CEPH_RELEASES.length - 1]!.release
}

export type CephRepository = 'enterprise' | 'no-subscription' | 'test' | 'manual'

export const CEPH_REPOSITORIES: { value: CephRepository; label: string; description: string }[] = [
  { value: 'enterprise', label: '企业版（推荐）', description: '需要有效订阅' },
  { value: 'no-subscription', label: '无订阅', description: '不建议用于生产环境' },
  { value: 'test', label: '测试', description: '尚未发布的软件包' },
  { value: 'manual', label: '手动', description: '不修改软件源配置' },
]

/** termproxy cmd-opts of `pveceph install` (NUL-separated arguments). */
export function installCmdOpts(release: string, repository: CephRepository): string {
  return ['--version', release, '--repository', repository].join('\0')
}

/** Hint under the repository choice (official repoHint formula). */
export function repositoryHint(repo: CephRepository, nodeHasSubscription: boolean): string | null {
  if (repo === 'enterprise') return nodeHasSubscription ? null : '企业版软件源需要有效订阅，这个节点没有订阅。'
  if (repo === 'no-subscription') return nodeHasSubscription ? '集群有订阅，可以使用企业版软件源。' : '无订阅软件源不适合生产环境。'
  if (repo === 'test') return '测试软件源只用于测试，可能不稳定。'
  return '手动：安装前需要自己配置好 Ceph 软件源。'
}

const CIDR4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/(3[0-2]|[12]?\d)$/
const CIDR6 = /^[0-9a-f:]+(?:%\w+)?\/(12[0-8]|1[01]\d|\d?\d)$/i

export function isCidr(value: string): boolean {
  const v = value.trim()
  return CIDR4.test(v) || (v.includes(':') && CIDR6.test(v))
}

/** "192.168.0.246/24" → "192.168.0.0/24" (IPv4; other values unchanged). */
export function networkOfCidr(cidr: string): string {
  const m = cidr.trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/)
  if (!m) return cidr.trim()
  const bits = Number(m[5])
  const ip = ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  const net = (ip & mask) >>> 0
  return `${net >>> 24}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${bits}`
}

export interface InitForm {
  network: string
  clusterNetwork: string
  size: number | null
  minSize: number | null
}

export function initFormError(f: InitForm): string | null {
  if (!f.network.trim()) return '请选择公共网络'
  if (!isCidr(f.network)) return '公共网络应为 CIDR，例如 10.10.10.0/24'
  if (f.clusterNetwork.trim() && !isCidr(f.clusterNetwork)) return '集群网络应为 CIDR'
  if (f.size != null && (f.size < 1 || f.size > 7)) return '副本数应为 1–7'
  if (f.minSize != null && f.size != null && f.minSize > f.size) return '最小副本数不能大于副本数'
  return null
}

/** POST /nodes/{node}/ceph/init (empty fields left to the server defaults). */
export function initParams(f: InitForm): Params {
  const out: Params = { network: f.network.trim() }
  if (f.clusterNetwork.trim()) out['cluster-network'] = f.clusterNetwork.trim()
  if (f.size != null) out.size = f.size
  if (f.minSize != null) out.min_size = f.minSize
  return out
}

// ---------------------------------------------------------------- services

export type ServiceType = 'mon' | 'mgr' | 'mds'

export const SERVICE_LABEL: Record<ServiceType | 'osd', string> = {
  mon: '监视器',
  mgr: '管理器',
  mds: '元数据服务器',
  osd: 'OSD',
}

/** Monitor / MDS IDs: letters, digits, hyphens; start with a letter, not end with a hyphen. */
export const SERVICE_ID_RE = /^[a-zA-Z]([-a-zA-Z0-9]*[a-zA-Z0-9])?$/

export type ServiceTone = 'ok' | 'warn' | 'err' | 'unknown' | 'old'

export interface ServiceRow {
  type: ServiceType
  /** Metadata key "<id>@<host>". */
  key: string
  name: string
  host: string
  addr?: string | undefined
  version?: string | undefined
  tone: ServiceTone
  /** "运行中" / "活动" / "备用" / "不在法定人数中" / "已停止" … */
  state: string
  /** Extra lines (health messages, version hints). */
  messages: string[]
}

/** mon / mgr / mds overview from /cluster/ceph/metadata and the status (official PVE.ceph.Services). */
export function buildServices(metadata: CephMetadata | undefined, status: CephStatus | undefined): Record<ServiceType, ServiceRow[]> {
  const maxVersion = newestNodeVersion(metadata)
  const quorum = new Set(status?.quorum_names ?? [])
  const monMessages = new Map<string, { tone: ServiceTone; lines: string[] }>()
  for (const [code, check] of Object.entries(status?.health?.checks ?? {})) {
    if (!code.startsWith('MON_')) continue
    for (const d of check.detail ?? []) {
      const m = d.message.match(/mon\.([a-zA-Z0-9\-.]+)/)
      if (!m) continue
      const id = m[1]!
      const entry = monMessages.get(id) ?? { tone: 'ok' as ServiceTone, lines: [] }
      entry.lines.push(d.message)
      const t = healthTone(check.severity)
      if (t === 'err' || (t === 'warn' && entry.tone === 'ok')) entry.tone = t
      monMessages.set(id, entry)
    }
  }
  const mgrState = new Map<string, 'active' | 'standby'>()
  if (status?.mgrmap?.active_name) mgrState.set(status.mgrmap.active_name, 'active')
  for (const s of status?.mgrmap?.standbys ?? []) mgrState.set(s.name, 'standby')
  const mdsState = new Map<string, string>()
  for (const m of status?.fsmap?.by_rank ?? []) mdsState.set(m.name, `rank ${m.rank} · ${m.status}`)

  const build = (type: ServiceType): ServiceRow[] =>
    Object.entries(metadata?.[type] ?? {})
      .map(([key, md]) => {
        const [idPart, hostPart] = key.split('@')
        const name = md.name || idPart || key
        const host = hostPart ?? md.hostname ?? ''
        const version = parseCephVersion(md)
        const addr = md.addr || md.addrs || undefined
        let tone: ServiceTone = 'ok'
        let state = '运行中'
        const messages: string[] = []
        if (type === 'mon') {
          if (!quorum.has(name)) {
            tone = 'err'
            state = '不在法定人数中'
          }
          const extra = monMessages.get(name)
          if (extra) {
            messages.push(...extra.lines)
            if (extra.tone === 'err' || (extra.tone === 'warn' && tone === 'ok')) tone = extra.tone
          }
        } else if (type === 'mgr') {
          const s = mgrState.get(name)
          if (s === 'active') state = '活动'
          else if (s === 'standby') state = '备用'
          else {
            tone = 'warn'
            state = '未连接'
          }
        } else {
          const s = mdsState.get(name)
          if (s) state = s
          else if (addr) state = '备用'
        }
        if (md.service && !version) {
          tone = 'unknown'
          state = '已停止'
        }
        if (!version && !addr) tone = 'unknown'
        if (version && maxVersion && compareCephVersions(version, maxVersion) !== 0) {
          const hostVersion = metadata?.node?.[host]?.version?.str
          if (tone === 'ok') tone = 'old'
          messages.push(
            hostVersion && compareCephVersions(hostVersion, maxVersion) === 0
              ? '已安装新版本，但仍在运行旧版本，请重启'
              : '其他节点使用了更新的版本，请升级并重启',
          )
        }
        return { type, key, name, host, addr, version, tone, state, messages }
      })
      .sort((a, b) => a.host.localeCompare(b.host) || a.name.localeCompare(b.name))

  return { mon: build('mon'), mgr: build('mgr'), mds: build('mds') }
}

// ---------------------------------------------------------------- OSD tree

export interface OsdRow {
  id: number
  name: string
  host: string
  up: boolean
  in: boolean
  deviceClass?: string | undefined
  osdType?: string | undefined
  /** 0..1 */
  usage: number | null
  used?: number | undefined
  total?: number | undefined
  applyLatency?: number | undefined
  commitLatency?: number | undefined
  pgs?: number | undefined
  version?: string | undefined
  crushWeight?: number | undefined
  reweight?: number | undefined
  blockDev?: string | null | undefined
  dbDev?: string | null | undefined
  walDev?: string | null | undefined
  /** Runs an older version than the host has installed. */
  outdated: boolean
}

export interface OsdHost {
  name: string
  /** Ceph version installed on the host. */
  version?: string | undefined
  osds: OsdRow[]
  /** CRUSH path above the host, e.g. ["default"]. */
  path: string[]
}

function toOsdRow(n: CephOsdTreeNode, host: string, hostVersion: string | undefined): OsdRow {
  const version = parseCephVersion(n)
  return {
    id: Number(n.id),
    name: n.name,
    host: n.host ?? host,
    up: n.status === 'up',
    in: Number(n.in ?? 0) === 1,
    deviceClass: n.device_class,
    osdType: n.osdtype,
    usage: typeof n.percent_used === 'number' ? n.percent_used / 100 : null,
    used: n.bytes_used,
    total: n.total_space,
    applyLatency: n.apply_latency_ms,
    commitLatency: n.commit_latency_ms,
    pgs: n.pgs,
    version,
    crushWeight: n.crush_weight,
    reweight: n.reweight,
    blockDev: n.blfsdev,
    dbDev: n.dbdev,
    walDev: n.waldev,
    outdated: !!(version && hostVersion && compareCephVersions(version, hostVersion) < 0),
  }
}

/** CRUSH tree → hosts with their OSDs (any bucket depth; OSDs outside a host go to a pseudo host). */
export function osdHosts(tree: CephOsdTree | undefined): OsdHost[] {
  const hosts: OsdHost[] = []
  const stray: OsdRow[] = []
  const walk = (nodes: CephOsdTreeNode[] | undefined, path: string[]) => {
    for (const n of nodes ?? []) {
      if (n.type === 'host') {
        const osds = (n.children ?? []).filter((c) => c.type === 'osd').map((c) => toOsdRow(c, n.name, n.version))
        osds.sort((a, b) => a.id - b.id)
        hosts.push({ name: n.name, version: n.version, osds, path })
      } else if (n.type === 'osd') {
        stray.push(toOsdRow(n, n.host ?? '', undefined))
      } else {
        walk(n.children, [...path, n.name])
      }
    }
  }
  walk(tree?.root?.children, [])
  hosts.sort((a, b) => a.name.localeCompare(b.name))
  if (stray.length) hosts.push({ name: '', osds: stray.sort((a, b) => a.id - b.id), path: [] })
  return hosts
}

/** OSD map flags that are set (from the tree's "flags"), ignoring the always-on internal ones. */
export function activeOsdFlags(tree: CephOsdTree | undefined): string[] {
  const internal = new Set(['sortbitwise', 'recovery_deletes', 'purged_snapdirs', 'pglog_hardlimit'])
  return (tree?.flags ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !internal.has(s))
}

export function osdStateLabel(o: Pick<OsdRow, 'up' | 'in'>): string {
  return `${o.up ? 'up' : 'down'} / ${o.in ? 'in' : 'out'}`
}

/** Why "destroy" is not possible yet (the API refuses running or "in" OSDs). */
export function osdDestroyBlocker(o: Pick<OsdRow, 'up' | 'in'>): string | null {
  if (o.up && o.in) return '先将 OSD 标记为 out 并停止'
  if (o.up) return '先停止 OSD'
  if (o.in) return '先将 OSD 标记为 out'
  return null
}

// ------------------------------------------------------------------- flags

export const FLAG_LABEL: Record<string, string> = {
  nobackfill: '暂停回填',
  'nodeep-scrub': '禁止深度清洗',
  nodown: '不标记 down',
  noin: '不自动 in',
  noout: '不自动 out',
  norebalance: '暂停再平衡',
  norecover: '暂停恢复',
  noscrub: '禁止清洗',
  notieragent: '暂停缓存分层',
  noup: '禁止 OSD 启动',
  pause: '暂停读写',
}

/** Flags that limit self-healing (destroy-OSD warning). */
export const HEALING_FLAGS = ['noout', 'norebalance', 'norecover']

export function flagIsSet(f: Pick<CephFlag, 'value'>): boolean {
  return f.value === 1 || f.value === true
}

/** Only flags whose value changed, as 0/1 (PUT /cluster/ceph/flags). */
export function flagChanges(current: readonly CephFlag[], next: Record<string, boolean>): Record<string, 0 | 1> | null {
  const out: Record<string, 0 | 1> = {}
  for (const f of current) {
    const want = next[f.name]
    if (want !== undefined && want !== flagIsSet(f)) out[f.name] = want ? 1 : 0
  }
  return Object.keys(out).length ? out : null
}

// -------------------------------------------------------------------- OSDs

export interface OsdCreateForm {
  dev: string
  dbDev: string
  /** GiB; null = automatic */
  dbSize: number | null
  walDev: string
  walSize: number | null
  encrypted: boolean
  deviceClass: string
  osdsPerDevice: number | null
}

export function osdCreateError(f: OsdCreateForm): string | null {
  if (!f.dev) return '请选择磁盘'
  if (f.osdsPerDevice != null && f.osdsPerDevice > 1 && (f.dbDev || f.walDev)) return '每盘多个 OSD 时不能单独指定 DB/WAL 磁盘'
  if (f.dbDev && f.dbDev === f.dev) return 'DB 磁盘不能是 OSD 磁盘本身'
  if (f.walDev && f.walDev === f.dev) return 'WAL 磁盘不能是 OSD 磁盘本身'
  return null
}

/** POST /nodes/{node}/ceph/osd */
export function osdCreateParams(f: OsdCreateForm): Params {
  const out: Params = { dev: f.dev }
  if (f.dbDev) {
    out.db_dev = f.dbDev
    if (f.dbSize != null && f.dbSize > 0) out.db_dev_size = f.dbSize
  }
  if (f.walDev) {
    out.wal_dev = f.walDev
    if (f.walSize != null && f.walSize > 0) out.wal_dev_size = f.walSize
  }
  if (f.encrypted) out.encrypted = 1
  if (f.deviceClass) out['crush-device-class'] = f.deviceClass
  if (f.osdsPerDevice != null && f.osdsPerDevice > 1) out['osds-per-device'] = f.osdsPerDevice
  return out
}

/** Device classes used in the CRUSH map beyond hdd/ssd/nvme (official CreateOsd). */
export function crushDeviceClasses(crush: string | undefined): string[] {
  const set = new Set<string>()
  for (const m of (crush ?? '').matchAll(/^device\s+\d+\s+osd\.\d+\s+class\s+(\S+)\s*$/gim)) {
    const c = m[1]!
    if (!['hdd', 'ssd', 'nvme'].includes(c)) set.add(c)
  }
  return [...set].sort()
}

// ------------------------------------------------------------------- pools

export const POOL_NAME_RE = /^[^:/\s]+$/

export interface PoolForm {
  name: string
  size: number
  minSize: number
  crushRule: string
  pgNum: number
  pgNumMin: number | null
  autoscale: PgAutoscaleMode
  application: PoolApplication
  /** null = not set */
  targetRatio: number | null
  /** GiB; null = not set */
  targetSizeGiB: number | null
  addStorages: boolean
}

export function defaultPoolForm(defaultSize = 3, defaultMinSize = 2): PoolForm {
  return {
    name: '',
    size: defaultSize,
    minSize: defaultMinSize,
    crushRule: 'replicated_rule',
    pgNum: 128,
    pgNumMin: null,
    autoscale: 'on',
    application: 'rbd',
    targetRatio: null,
    targetSizeGiB: null,
    addStorages: true,
  }
}

/** Official sizeChange: min_size follows round(size / 2) when that is > 1. */
export function minSizeFor(size: number, current: number): number {
  const m = Math.round(size / 2)
  return m > 1 ? m : current
}

/** Data-safety warning under min_size (official hints). */
export function minSizeWarning(size: number, minSize: number): string | null {
  if (minSize === 1) return 'min_size 为 1 有丢失数据的风险，不建议使用'
  if (minSize < size / 2 && minSize !== size) return 'min_size 小于 size 的一半可能导致数据丢失、PG 不完整或对象丢失'
  return null
}

export function poolFormError(f: PoolForm, existing: readonly string[] = []): string | null {
  const name = f.name.trim()
  if (!name) return '请输入名称'
  if (!POOL_NAME_RE.test(name)) return '名称不能包含空格、冒号或斜杠'
  if (existing.includes(name)) return '已有同名存储池'
  if (f.size < 1 || f.size > 7) return 'size 应为 1–7'
  if (f.minSize < 1 || f.minSize > 7) return 'min_size 应为 1–7'
  if (f.minSize > f.size) return 'min_size 不能大于 size'
  if (f.pgNum < 1 || f.pgNum > 32768) return 'PG 数应为 1–32768'
  if (f.targetRatio != null && f.targetRatio < 0) return '目标比例不能为负数'
  if (f.targetSizeGiB != null && f.targetSizeGiB < 0) return '目标大小不能为负数'
  return null
}

function targetSizeParam(gib: number | null): string | undefined {
  if (gib == null || gib <= 0) return undefined
  return Number.isInteger(gib) ? `${gib}G` : `${Math.round(gib * 1024)}M`
}

/** POST /nodes/{node}/ceph/pool */
export function poolCreateParams(f: PoolForm): Params {
  const out: Params = {
    name: f.name.trim(),
    size: f.size,
    min_size: f.minSize,
    pg_num: f.pgNum,
    pg_autoscale_mode: f.autoscale,
    application: f.application,
    add_storages: f.addStorages ? 1 : 0,
  }
  if (f.crushRule) out.crush_rule = f.crushRule
  if (f.pgNumMin != null && f.pgNumMin > 0) out.pg_num_min = f.pgNumMin
  if (f.targetRatio != null && f.targetRatio > 0) out.target_size_ratio = f.targetRatio
  const ts = targetSizeParam(f.targetSizeGiB)
  if (ts) out.target_size = ts
  return out
}

/** Editable settings of an existing pool as a form. */
export function poolFormFromStatus(s: CephPoolStatus): PoolForm {
  const app = (s.application ?? s.application_list?.[0] ?? 'rbd') as PoolApplication
  return {
    name: s.name,
    size: s.size ?? 3,
    minSize: s.min_size ?? 2,
    crushRule: s.crush_rule ?? 'replicated_rule',
    pgNum: s.pg_num ?? 128,
    pgNumMin: s.pg_num_min ? s.pg_num_min : null,
    autoscale: s.pg_autoscale_mode ?? 'on',
    application: ['rbd', 'cephfs', 'rgw'].includes(app) ? app : 'rbd',
    targetRatio: s.target_size_ratio ? s.target_size_ratio : null,
    targetSizeGiB: s.target_size ? Math.round((s.target_size / 1024 ** 3) * 100) / 100 : null,
    addStorages: false,
  }
}

/** PUT /nodes/{node}/ceph/pool/{name}: only changed settings; null when nothing changed. */
export function poolUpdateParams(before: PoolForm, after: PoolForm): Params | null {
  const out: Params = {}
  if (after.size !== before.size) out.size = after.size
  if (after.minSize !== before.minSize) out.min_size = after.minSize
  if (after.crushRule !== before.crushRule && after.crushRule) out.crush_rule = after.crushRule
  if (after.pgNum !== before.pgNum) out.pg_num = after.pgNum
  if (after.pgNumMin !== before.pgNumMin) out.pg_num_min = after.pgNumMin ?? 0
  if (after.autoscale !== before.autoscale) out.pg_autoscale_mode = after.autoscale
  if (after.application !== before.application) out.application = after.application
  if (after.targetRatio !== before.targetRatio) out.target_size_ratio = after.targetRatio ?? 0
  if (after.targetSizeGiB !== before.targetSizeGiB) out.target_size = targetSizeParam(after.targetSizeGiB) ?? '0'
  return Object.keys(out).length ? out : null
}

/** "rbd, cephfs" from application_metadata. */
export function poolApplications(meta: Record<string, unknown> | undefined): string[] {
  return Object.keys(meta ?? {}).sort()
}

// ------------------------------------------------------------------ CephFS

export const CEPHFS_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-_.]*$/

export function cephFsCreateParams(f: { pgNum: number; addStorage: boolean }): Params {
  return { pg_num: f.pgNum, 'add-storage': f.addStorage ? 1 : 0 }
}

// --------------------------------------------------------------------- log

export type CephLogLevel = 'DBG' | 'INF' | 'WRN' | 'ERR' | 'SEC' | null

/** "… cluster [WRN] …" → "WRN". */
export function logLevel(line: string): CephLogLevel {
  const m = line.match(/\[(DBG|INF|WRN|ERR|SEC)\]/)
  return (m?.[1] as CephLogLevel) ?? null
}
