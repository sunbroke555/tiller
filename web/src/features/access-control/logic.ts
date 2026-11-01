// Pure logic of the access-control screens: form → API parameters, parsing
// of the realm's property strings, privilege grouping, ACL paths.
// Rules follow the official UI (pvemanagerlib.js: PVE.dc.ACLAdd/ACLView,
// PVE.dc.RoleEdit, PVE.panel.*InputPanel, PVE.dc.SyncWindow,
// PVE.dc.RealmSyncJobEdit, PVE.dc.PoolEdit, PVE.pool.AddVM/AddStorage).

import type { Params } from '@/api/client'
import type { AclEntry, AclSubjectType, RealmConfig, RealmType, SyncJob } from '@/api/access-control'
import { isGuest, type ClusterResource } from '@/api/types'
import { normalizeAclPath, type PermissionCheck } from '@/lib/permissions'
import { configChanges, parsePropertyString, stringifyPropertyString, type ConfigValues } from '@/lib/propstring'

// =================================================================== ACL

export const ACL_SUBJECT_LABEL: Record<AclSubjectType, string> = {
  user: '用户',
  group: '组',
  token: 'API 令牌',
}

const SUBJECT_PARAM: Record<AclSubjectType, 'users' | 'groups' | 'tokens'> = {
  user: 'users',
  group: 'groups',
  token: 'tokens',
}

export interface AclForm {
  path: string
  type: AclSubjectType
  subject: string
  role: string
  /** Inherit to child paths (the API default is 1). */
  propagate: boolean
}

/** PUT /access/acl parameters that add one permission. */
export function aclAddParams(f: AclForm): Params {
  return {
    path: normalizeAclPath(f.path),
    roles: f.role,
    [SUBJECT_PARAM[f.type]]: f.subject.trim(),
    propagate: f.propagate ? 1 : 0,
  }
}

/** PUT /access/acl parameters that remove one entry (as the official "Remove" button). */
export function aclRemoveParams(e: AclEntry): Params {
  return { delete: 1, path: e.path, roles: e.roleid, [SUBJECT_PARAM[e.type]]: e.ugid }
}

/** Paths PVE accepts: "/" and slash separated names (no spaces or commas). */
export function aclPathError(path: string): string | null {
  const p = path.trim()
  if (!p) return '请填写路径'
  if (!p.startsWith('/')) return '路径以 / 开头'
  if (/[\s,;]/.test(p)) return '路径不能包含空格、逗号或分号'
  return null
}

export function validateAclForm(f: AclForm, fixedPath: boolean): Partial<Record<'path' | 'subject' | 'role', string>> {
  const errors: Partial<Record<'path' | 'subject' | 'role', string>> = {}
  if (!fixedPath) {
    const pe = aclPathError(f.path)
    if (pe) errors.path = pe
  }
  if (!f.subject.trim()) errors.subject = `请选择${ACL_SUBJECT_LABEL[f.type]}`
  if (!f.role) errors.role = '请选择角色'
  return errors
}

/**
 * Who may change the ACL of a path (RPCEnvironment::check_perm_modify):
 * Permissions.Modify, or the "allocate" privilege of the object kind.
 */
export function aclModifyCheck(path: string): PermissionCheck {
  const p = normalizeAclPath(path)
  const privs = ['Permissions.Modify']
  if (/^\/storage\/.+/.test(p)) privs.push('Datastore.Allocate')
  else if (/^\/vms\/.+/.test(p)) privs.push('VM.Allocate')
  else if (/^\/pool\/.+/.test(p)) privs.push('Pool.Allocate')
  return { privs, any: true, path: p }
}

const TYPE_ORDER: Record<AclSubjectType, number> = { group: 0, user: 1, token: 2 }

export function compareAcl(a: AclEntry, b: AclEntry): number {
  return (
    a.path.localeCompare(b.path) ||
    TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
    a.ugid.localeCompare(b.ugid) ||
    a.roleid.localeCompare(b.roleid)
  )
}

/** Stable key of an ACL entry. */
export function aclKey(e: AclEntry): string {
  return `${e.path}|${e.type}|${e.ugid}|${e.roleid}`
}

/** The fixed paths of the official path selector (PVE.data.PermPathStore). */
export const STATIC_ACL_PATHS = [
  '/',
  '/access',
  '/access/groups',
  '/access/realm',
  '/mapping',
  '/mapping/cpu',
  '/mapping/hwrng',
  '/mapping/notifications',
  '/mapping/pci',
  '/mapping/usb',
  '/nodes',
  '/pool',
  '/sdn/fabrics',
  '/sdn/zones',
  '/storage',
  '/vms',
] as const

export interface AclPathOption {
  value: string
  /** Chinese description ("客户机 100 · web-01"). */
  label: string
  group: AclPathGroup
}

export type AclPathGroup = 'general' | 'vms' | 'storage' | 'pool' | 'nodes' | 'sdn'

export const ACL_PATH_GROUP_LABEL: Record<AclPathGroup, string> = {
  general: '通用',
  vms: '客户机',
  storage: '存储',
  pool: '资源池',
  nodes: '节点',
  sdn: 'SDN',
}

/** Short Chinese description of an ACL path. */
export function describeAclPath(path: string, names?: ReadonlyMap<string, string>): string {
  const p = normalizeAclPath(path)
  const fixed: Record<string, string> = {
    '/': '整个数据中心',
    '/access': '访问控制',
    '/access/groups': '所有组',
    '/access/realm': '所有认证域',
    '/mapping': '所有资源映射',
    '/mapping/cpu': '自定义 CPU 型号',
    '/mapping/hwrng': '硬件随机数映射',
    '/mapping/notifications': '通知目标与匹配器',
    '/mapping/pci': 'PCI 映射',
    '/mapping/usb': 'USB 映射',
    '/mapping/dir': '目录映射',
    '/nodes': '所有节点',
    '/pool': '所有资源池',
    '/sdn': 'SDN',
    '/sdn/fabrics': '所有 Fabric',
    '/sdn/zones': '所有 Zone',
    '/storage': '所有存储',
    '/vms': '所有客户机',
  }
  if (fixed[p]) return fixed[p]
  const [, top, ...rest] = p.split('/')
  const id = rest.join('/')
  const named = names?.get(p)
  switch (top) {
    case 'vms':
      return named ? `客户机 ${id} · ${named}` : `客户机 ${id}`
    case 'storage':
      return `存储 ${id}`
    case 'pool':
      return `资源池 ${id}`
    case 'nodes':
      return `节点 ${id}`
    case 'access':
      if (rest[0] === 'groups') return `组 ${rest.slice(1).join('/')}`
      if (rest[0] === 'realm') return `认证域 ${rest.slice(1).join('/')}`
      return p
    case 'sdn':
      if (rest[0] === 'zones') return rest.length > 2 ? `VNet ${rest.slice(2).join('/')}（Zone ${rest[1]}）` : `Zone ${rest[1]}`
      if (rest[0] === 'vnets') return `VNet ${rest[1]}`
      if (rest[0] === 'fabrics') return `Fabric ${rest[1]}`
      return p
    case 'mapping':
      return `${rest[0] === 'pci' ? 'PCI' : rest[0] === 'usb' ? 'USB' : rest[0] === 'dir' ? '目录' : (rest[0] ?? '')} 映射 ${rest.slice(1).join('/')}`.trim()
    default:
      return p
  }
}

/** Guest names by ACL path ("/vms/100" → "web-01"). */
export function guestNamesByPath(resources: readonly ClusterResource[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of resources) if (isGuest(r) && r.name) out.set(`/vms/${r.vmid}`, r.name)
  return out
}

const PATH_GROUP_ORDER: AclPathGroup[] = ['general', 'vms', 'storage', 'pool', 'nodes', 'sdn']

/**
 * The path picker's options: the official fixed list plus every node,
 * guest, storage, pool and SDN zone/VNet of the cluster.
 */
export function aclPathOptions(resources: readonly ClusterResource[], pools: readonly string[] = []): AclPathOption[] {
  const names = guestNamesByPath(resources)
  const groups = new Map<AclPathGroup, Map<string, number>>(PATH_GROUP_ORDER.map((g) => [g, new Map()]))
  const add = (value: string, group: AclPathGroup, sortKey = 0) => groups.get(group)!.set(value, sortKey)
  for (const p of STATIC_ACL_PATHS) add(p, 'general')
  for (const r of resources) {
    if (isGuest(r)) add(`/vms/${r.vmid}`, 'vms', r.vmid)
    else if (r.type === 'node') add(`/nodes/${r.node}`, 'nodes')
    else if (r.type === 'storage') add(`/storage/${r.storage}`, 'storage')
    else if (r.type === 'pool') add(`/pool/${r.pool}`, 'pool')
    else if (r.type === 'sdn' && r.sdn) add(`/sdn/zones/${r.sdn}`, 'sdn')
    else if (r.type === 'network' && r.network && r['network-type']) add(`/sdn/${r['network-type']}s/${r.network}`, 'sdn')
  }
  for (const pool of pools) add(`/pool/${pool}`, 'pool')
  const out: AclPathOption[] = []
  for (const group of PATH_GROUP_ORDER) {
    const entries = [...groups.get(group)!.entries()]
    if (group === 'vms') entries.sort((a, b) => a[1] - b[1])
    else if (group !== 'general') entries.sort((a, b) => a[0].localeCompare(b[0]))
    for (const [value] of entries) out.push({ value, label: describeAclPath(value, names), group })
  }
  return out
}

/** Case-insensitive match on path or description. */
export function filterPathOptions(options: readonly AclPathOption[], query: string): AclPathOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...options]
  return options.filter((o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
}

// ============================================================ privileges

export interface PrivilegeGroup {
  id: string
  label: string
  privs: string[]
}

const PRIV_GROUP_ORDER = ['VM', 'Datastore', 'Sys', 'SDN', 'Mapping', 'Pool', 'User', 'Group', 'Realm', 'Permissions'] as const

export const PRIV_GROUP_LABEL: Record<string, string> = {
  VM: '虚拟机与容器',
  Datastore: '存储',
  Sys: '系统',
  SDN: 'SDN',
  Mapping: '资源映射',
  Pool: '资源池',
  User: '用户',
  Group: '组',
  Realm: '认证域',
  Permissions: '权限',
}

/** One line per privilege (pveum documentation, shortened). */
export const PRIV_HINT: Record<string, string> = {
  'Datastore.Allocate': '创建、修改、删除存储',
  'Datastore.AllocateSpace': '在存储上分配空间',
  'Datastore.AllocateTemplate': '上传、删除模板和 ISO',
  'Datastore.Audit': '查看存储',
  'Group.Allocate': '创建、删除组',
  'Mapping.Audit': '查看资源映射',
  'Mapping.Modify': '管理资源映射',
  'Mapping.Use': '使用资源映射',
  'Permissions.Modify': '修改访问权限',
  'Pool.Allocate': '创建、修改、删除资源池',
  'Pool.Audit': '查看资源池',
  'Realm.Allocate': '管理认证域',
  'Realm.AllocateUser': '把用户分配到认证域',
  'SDN.Allocate': '管理 SDN 配置',
  'SDN.Audit': '查看 SDN',
  'SDN.Use': '使用 SDN 网络',
  'Sys.AccessNetwork': '从节点访问网络（如下载 URL）',
  'Sys.Audit': '查看节点状态与配置',
  'Sys.Console': '节点控制台',
  'Sys.Incoming': '接收其他集群的迁移',
  'Sys.Modify': '修改节点与集群设置',
  'Sys.PowerMgmt': '节点电源管理',
  'Sys.Syslog': '查看系统日志',
  'User.Modify': '创建、修改、删除用户',
  'VM.Allocate': '创建、删除客户机',
  'VM.Audit': '查看客户机配置',
  'VM.Backup': '备份与恢复',
  'VM.Clone': '克隆',
  'VM.Config.CDROM': '更换光驱介质',
  'VM.Config.CPU': '修改 CPU',
  'VM.Config.Cloudinit': '修改 Cloud-Init',
  'VM.Config.Disk': '增删、修改磁盘',
  'VM.Config.HWType': '修改硬件类型',
  'VM.Config.Memory': '修改内存',
  'VM.Config.Network': '修改网络',
  'VM.Config.Options': '修改其他选项',
  'VM.Console': '控制台',
  'VM.GuestAgent.Audit': '读取客户机代理信息',
  'VM.GuestAgent.FileRead': '通过代理读文件',
  'VM.GuestAgent.FileSystemMgmt': '通过代理冻结/解冻文件系统',
  'VM.GuestAgent.FileWrite': '通过代理写文件',
  'VM.GuestAgent.Unrestricted': '客户机代理全部命令',
  'VM.Migrate': '迁移',
  'VM.PowerMgmt': '电源操作',
  'VM.Replicate': '存储复制',
  'VM.Snapshot': '创建、删除快照',
  'VM.Snapshot.Rollback': '回滚快照',
}

/** "a,b, c" → ['a', 'b', 'c']. */
export function parsePrivs(privs: string | undefined | null): string[] {
  return (privs ?? '')
    .split(/[,\s;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Privileges grouped by their prefix ("VM.Config.CPU" → VM), in a fixed order. */
export function groupPrivileges(privs: readonly string[]): PrivilegeGroup[] {
  const map = new Map<string, string[]>()
  for (const p of privs) {
    const g = p.split('.')[0] ?? p
    const list = map.get(g) ?? []
    list.push(p)
    map.set(g, list)
  }
  const order = (g: string) => {
    const i = (PRIV_GROUP_ORDER as readonly string[]).indexOf(g)
    return i === -1 ? PRIV_GROUP_ORDER.length : i
  }
  return [...map.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([id, list]) => ({ id, label: PRIV_GROUP_LABEL[id] ?? id, privs: list.sort() }))
}

// ================================================================= roles

export function roleIdError(id: string, existing: readonly string[] = []): string | null {
  const v = id.trim()
  if (!v) return '请填写名称'
  if (!/^[A-Za-z0-9.\-_]+$/.test(v)) return '只能包含字母、数字、点、短横线和下划线'
  if (/^pve/i.test(v)) return '以 PVE 开头的名称留给内置角色'
  if (existing.some((e) => e.toLowerCase() === v.toLowerCase())) return '已有同名角色'
  return null
}

export function roleCreateParams(roleid: string, privs: readonly string[]): Params {
  return { roleid: roleid.trim(), privs: [...privs].sort().join(',') }
}

/** PUT /access/roles/{id}: replaces the privilege list; null when unchanged. */
export function roleUpdateParams(before: readonly string[], after: readonly string[]): Params | null {
  const a = new Set(before)
  const b = new Set(after)
  if (a.size === b.size && [...a].every((x) => b.has(x))) return null
  return { privs: [...b].sort().join(',') }
}

// ================================================================ realms

export const REALM_TYPE_LABEL: Record<RealmType, string> = {
  pam: 'Linux PAM',
  pve: 'Proxmox VE',
  ldap: 'LDAP',
  ad: 'Active Directory',
  openid: 'OpenID Connect',
}

export function realmTypeLabel(type: string): string {
  return REALM_TYPE_LABEL[type as RealmType] ?? type
}

/** Types that can be added (pam and pve exist once and cannot be removed). */
export const ADDABLE_REALM_TYPES = ['ad', 'ldap', 'openid'] as const satisfies readonly RealmType[]

export function realmSupportsTfa(type: string): boolean {
  return type !== 'openid'
}

export function realmSupportsSync(type: string): boolean {
  return type === 'ldap' || type === 'ad'
}

export function realmIsAddable(type: string): boolean {
  return (ADDABLE_REALM_TYPES as readonly string[]).includes(type)
}

// ---- TFA ("type=oath,step=30,digits=6" / "type=yubico,id=…,key=…,url=…")

export type TfaType = '' | 'oath' | 'yubico'

export interface TfaForm {
  type: TfaType
  step: string
  digits: string
  id: string
  key: string
  url: string
}

export const EMPTY_TFA: TfaForm = { type: '', step: '', digits: '', id: '', key: '', url: '' }

export function parseTfa(value: string | undefined | null): TfaForm {
  if (!value) return { ...EMPTY_TFA }
  const m = parsePropertyString(value, 'type')
  const type = m.type === 'oath' || m.type === 'yubico' ? m.type : ''
  return { type, step: m.step ?? '', digits: m.digits ?? '', id: m.id ?? '', key: m.key ?? '', url: m.url ?? '' }
}

export function stringifyTfa(t: TfaForm): string {
  if (t.type === 'oath') return stringifyPropertyString({ type: 'oath', step: t.step.trim(), digits: t.digits.trim() })
  if (t.type === 'yubico') return stringifyPropertyString({ type: 'yubico', id: t.id.trim(), key: t.key.trim(), url: t.url.trim() })
  return ''
}

export function tfaLabel(value: string | undefined | null): string {
  const t = parseTfa(value)
  if (t.type === 'oath') return 'OATH/TOTP'
  if (t.type === 'yubico') return 'Yubico'
  return ''
}

// ---- sync options

export type SyncScope = '' | 'users' | 'groups' | 'both'

export const SYNC_SCOPE_LABEL: Record<Exclude<SyncScope, ''>, string> = {
  users: '用户',
  groups: '组',
  both: '用户和组',
}

export interface RemoveVanished {
  acl: boolean
  entry: boolean
  properties: boolean
}

export const NO_VANISHED: RemoveVanished = { acl: false, entry: false, properties: false }

export function parseRemoveVanished(value: string | undefined | null): RemoveVanished {
  const parts = new Set((value ?? '').split(';').map((s) => s.trim()))
  return { acl: parts.has('acl'), entry: parts.has('entry'), properties: parts.has('properties') }
}

/** "acl;entry" or "" (none). */
export function stringifyRemoveVanished(rv: RemoveVanished): string {
  return (['acl', 'entry', 'properties'] as const).filter((k) => rv[k]).join(';')
}

export interface SyncDefaults {
  scope: SyncScope
  /** '' = default (yes). */
  enableNew: '' | '1' | '0'
  removeVanished: RemoveVanished
}

export function parseSyncDefaults(value: string | undefined | null): SyncDefaults & { rest: Record<string, string> } {
  const m = value ? parsePropertyString(value) : {}
  const { scope, 'enable-new': enableNew, 'remove-vanished': rv, ...rest } = m
  return {
    scope: scope === 'users' || scope === 'groups' || scope === 'both' ? scope : '',
    enableNew: enableNew === '1' || enableNew === '0' ? enableNew : '',
    removeVanished: parseRemoveVanished(rv),
    rest,
  }
}

/** sync-defaults-options from the form, keeping keys the form does not manage (full, purge). */
export function buildSyncDefaults(before: string | undefined | null, d: SyncDefaults): string {
  const { rest } = parseSyncDefaults(before)
  const rv = stringifyRemoveVanished(d.removeVanished)
  return stringifyPropertyString({
    ...rest,
    scope: d.scope || undefined,
    'enable-new': d.enableNew || undefined,
    'remove-vanished': rv || undefined,
  })
}

/** sync_attributes with the e-mail attribute set (other mappings kept). */
export function buildSyncAttributes(before: string | undefined | null, email: string): string {
  const m = before ? parsePropertyString(before) : {}
  return stringifyPropertyString({ ...m, email: email.trim() || undefined })
}

// ---- the realm form

export type LdapMode = '' | 'ldap' | 'ldap+starttls' | 'ldaps'

export interface RealmForm {
  realm: string
  comment: string
  default: boolean
  tfa: TfaForm
  // LDAP / AD
  base_dn: string
  user_attr: string
  domain: string
  caseSensitive: boolean
  server1: string
  server2: string
  port: string
  mode: LdapMode
  verify: boolean
  checkConnection: boolean
  // LDAP / AD sync options
  bind_dn: string
  /** Write-only: empty = unchanged. */
  password: string
  emailAttr: string
  group_name_attr: string
  user_classes: string
  group_classes: string
  filter: string
  group_filter: string
  syncDefaults: SyncDefaults
  // OpenID
  issuerUrl: string
  clientId: string
  clientKey: string
  scopes: string
  autocreate: boolean
  usernameClaim: string
  groupsAutocreate: boolean
  groupsClaim: string
  groupsOverwrite: boolean
  prompt: string
  acrValues: string
  queryUserinfo: boolean
  audiences: string
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v))
const flag = (v: unknown, fallback: boolean): boolean => (v === undefined || v === null || v === '' ? fallback : String(v) === '1')

export function realmToForm(cfg: RealmConfig | null | undefined, realm = ''): RealmForm {
  const c = (cfg ?? {}) as Record<string, unknown>
  const sync = parseSyncDefaults(str(c['sync-defaults-options']))
  const attrs = c.sync_attributes ? parsePropertyString(str(c.sync_attributes)) : {}
  let mode = str(c.mode) as LdapMode
  if (!mode && c.secure !== undefined) mode = flag(c.secure, false) ? 'ldaps' : 'ldap'
  return {
    realm: realm || str(c.realm),
    comment: str(c.comment),
    default: flag(c.default, false),
    tfa: parseTfa(str(c.tfa)),
    base_dn: str(c.base_dn),
    user_attr: str(c.user_attr),
    domain: str(c.domain),
    caseSensitive: flag(c['case-sensitive'], true),
    server1: str(c.server1),
    server2: str(c.server2),
    port: str(c.port),
    mode,
    verify: flag(c.verify, false),
    // The official dialog checks the connection on every save (advanced option).
    checkConnection: true,
    bind_dn: str(c.bind_dn),
    password: '',
    emailAttr: attrs.email ?? '',
    group_name_attr: str(c.group_name_attr),
    user_classes: str(c.user_classes),
    group_classes: str(c.group_classes),
    filter: str(c.filter),
    group_filter: str(c.group_filter),
    syncDefaults: { scope: sync.scope, enableNew: sync.enableNew, removeVanished: sync.removeVanished },
    issuerUrl: str(c['issuer-url']),
    clientId: str(c['client-id']),
    clientKey: str(c['client-key']),
    scopes: str(c.scopes),
    autocreate: flag(c.autocreate, false),
    usernameClaim: str(c['username-claim']),
    groupsAutocreate: flag(c['groups-autocreate'], false),
    groupsClaim: str(c['groups-claim']),
    groupsOverwrite: flag(c['groups-overwrite'], false),
    prompt: str(c.prompt),
    acrValues: str(c['acr-values']),
    queryUserinfo: flag(c['query-userinfo'], true),
    audiences: str(c.audiences),
  }
}

export type RealmFormErrors = Partial<Record<string, string>>

export function validateRealmForm(type: string, f: RealmForm, isCreate: boolean): RealmFormErrors {
  const e: RealmFormErrors = {}
  if (isCreate) {
    if (!f.realm.trim()) e.realm = '请填写名称'
    else if (!/^[A-Za-z][A-Za-z0-9.\-_]+$/.test(f.realm.trim())) e.realm = '以字母开头，至少 2 个字符，只能包含字母、数字、点、短横线和下划线'
  }
  if (type === 'ldap') {
    if (!f.base_dn.trim()) e.base_dn = '请填写 Base DN'
    if (f.user_attr.trim().length < 2) e.user_attr = '请填写用户属性（至少 2 个字符）'
  }
  if (type === 'ad' && !f.domain.trim()) e.domain = '请填写域名'
  if (type === 'ldap' || type === 'ad') {
    if (!f.server1.trim()) e.server1 = '请填写服务器'
    if (f.port.trim()) {
      const n = Number(f.port)
      if (!Number.isInteger(n) || n < 1 || n > 65535) e.port = '端口为 1–65535'
    }
  }
  if (type === 'openid') {
    if (!f.issuerUrl.trim()) e['issuer-url'] = '请填写 Issuer URL'
    if (!f.clientId.trim()) e['client-id'] = '请填写 Client ID'
    if (f.groupsClaim.trim() && !/^[A-Za-z0-9.\-_]+$/.test(f.groupsClaim.trim())) e['groups-claim'] = '只能包含字母、数字、点、短横线和下划线'
  }
  if (realmSupportsTfa(type)) {
    if (f.tfa.type === 'oath') {
      if (f.tfa.step && (!/^\d+$/.test(f.tfa.step) || Number(f.tfa.step) < 10)) e.tfaStep = '至少 10 秒'
      if (f.tfa.digits && (!/^\d+$/.test(f.tfa.digits) || Number(f.tfa.digits) < 6 || Number(f.tfa.digits) > 8)) e.tfaDigits = '6–8 位'
    }
    if (f.tfa.type === 'yubico') {
      if (!f.tfa.id.trim()) e.tfaId = '请填写 Yubico API ID'
      if (!f.tfa.key.trim()) e.tfaKey = '请填写 Yubico API Key'
    }
  }
  return e
}

/** Same keys and values, in any order. */
export function samePropertyString(a: string, b: string): boolean {
  try {
    const x = parsePropertyString(a)
    const y = parsePropertyString(b)
    const kx = Object.keys(x)
    return kx.length === Object.keys(y).length && kx.every((k) => x[k] === y[k])
  } catch {
    return a === b
  }
}

/** A boolean option: null (= absent, the server default) when it equals the default. */
function boolOpt(v: boolean, fallback: boolean): string | null {
  return v === fallback ? null : v ? '1' : '0'
}

const txt = (v: string): string | null => (v.trim() === '' ? null : v.trim())

/** The options of `type` the form manages, as they should be stored. */
function realmValues(type: string, f: RealmForm, before: RealmConfig | null): ConfigValues {
  const v: ConfigValues = { comment: txt(f.comment) }
  // `default` is a flag the server moves between realms; send 0 to clear it.
  v.default = f.default ? '1' : before && flag(before.default, false) ? '0' : null
  if (realmSupportsTfa(type)) v.tfa = txt(stringifyTfa(f.tfa))
  if (type === 'ldap' || type === 'ad') {
    if (type === 'ldap') {
      v.base_dn = txt(f.base_dn)
      v.user_attr = txt(f.user_attr)
    } else {
      v.domain = txt(f.domain)
      v['case-sensitive'] = boolOpt(f.caseSensitive, true)
    }
    v.server1 = txt(f.server1)
    v.server2 = txt(f.server2)
    v.port = txt(f.port)
    v.mode = f.mode || null
    // Certificate verification only applies to TLS modes.
    v.verify = f.mode === 'ldaps' || f.mode === 'ldap+starttls' ? boolOpt(f.verify, false) : null
    v.bind_dn = txt(f.bind_dn)
    v.group_name_attr = txt(f.group_name_attr)
    v.user_classes = txt(f.user_classes)
    v.group_classes = txt(f.group_classes)
    v.filter = txt(f.filter)
    v.group_filter = txt(f.group_filter)
    v.sync_attributes = txt(buildSyncAttributes(before?.sync_attributes as string | undefined, f.emailAttr))
    v['sync-defaults-options'] = txt(buildSyncDefaults(before?.['sync-defaults-options'] as string | undefined, f.syncDefaults))
  }
  // Property strings the server may print in another key order: keep its
  // spelling when the content is the same, so an untouched form is unchanged.
  for (const key of ['tfa', 'sync_attributes', 'sync-defaults-options']) {
    const old = before?.[key]
    const next = v[key]
    if (typeof old === 'string' && typeof next === 'string' && samePropertyString(old, next)) v[key] = old
  }
  if (type === 'openid') {
    v['issuer-url'] = txt(f.issuerUrl)
    v['client-id'] = txt(f.clientId)
    v['client-key'] = txt(f.clientKey)
    v.scopes = txt(f.scopes)
    v.autocreate = boolOpt(f.autocreate, false)
    if (!before) v['username-claim'] = txt(f.usernameClaim)
    v['groups-autocreate'] = boolOpt(f.groupsAutocreate, false)
    v['groups-claim'] = txt(f.groupsClaim)
    v['groups-overwrite'] = boolOpt(f.groupsOverwrite, false)
    v.prompt = txt(f.prompt)
    v['acr-values'] = txt(f.acrValues)
    v['query-userinfo'] = boolOpt(f.queryUserinfo, true)
    v.audiences = txt(f.audiences)
  }
  return v
}

/**
 * POST /access/domains (before = null) or PUT /access/domains/{realm}
 * parameters; null when an edit changes nothing. Edits send only changed
 * options, clear emptied ones with `delete`, and carry the digest.
 */
export function realmParams(type: string, f: RealmForm, before: RealmConfig | null): Params | null {
  const values = realmValues(type, f, before)
  const ldapLike = type === 'ldap' || type === 'ad'
  if (!before) {
    const params: Params = { realm: f.realm.trim(), type }
    for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) params[k] = v as string
    if (ldapLike && f.password) params.password = f.password
    if (ldapLike && f.checkConnection) params['check-connection'] = 1
    return params
  }
  // A realm that still has the deprecated `secure` flag: it was mapped to
  // `mode` when the form loaded, so make sure mode is written out.
  const hasSecure = before.secure !== undefined && before.secure !== null
  const cmpBefore: ConfigValues = { ...(before as ConfigValues) }
  if (hasSecure && !before.mode) cmpBefore.mode = null
  const { set, delete: del } = configChanges(cmpBefore, values)
  if (ldapLike && hasSecure) del.push('secure')
  const params: Params = { ...set }
  if (ldapLike && f.password) params.password = f.password
  if (Object.keys(params).length === 0 && del.length === 0) return null
  if (del.length) params.delete = del.join(',')
  if (ldapLike && f.checkConnection) params['check-connection'] = 1
  if (before.digest) params.digest = before.digest
  return params
}

// ---- realm sync

export interface SyncForm {
  scope: SyncScope
  enableNew: '1' | '0'
  removeVanished: RemoveVanished
}

/** The sync window starts from the realm's default sync options. */
export function syncFormFromDefaults(cfg: RealmConfig | null | undefined): SyncForm {
  const d = parseSyncDefaults(cfg?.['sync-defaults-options'] as string | undefined)
  return { scope: d.scope, enableNew: d.enableNew === '0' ? '0' : '1', removeVanished: d.removeVanished }
}

/** POST /access/domains/{realm}/sync parameters. */
export function syncParams(f: SyncForm, dryRun: boolean): Params {
  return {
    scope: f.scope || undefined,
    'enable-new': f.enableNew === '0' ? 0 : 1,
    'remove-vanished': stringifyRemoveVanished(f.removeVanished) || 'none',
    'dry-run': dryRun ? 1 : 0,
  }
}

// ---- realm sync jobs

export interface SyncJobForm extends SyncForm {
  id: string
  realm: string
  schedule: string
  enabled: boolean
  comment: string
}

export function emptySyncJobForm(): SyncJobForm {
  return { id: '', realm: '', schedule: '', enabled: true, comment: '', scope: '', enableNew: '1', removeVanished: { ...NO_VANISHED } }
}

export function syncJobToForm(j: SyncJob): SyncJobForm {
  return {
    id: j.id,
    realm: j.realm,
    schedule: j.schedule ?? '',
    enabled: j.enabled === undefined ? true : String(j.enabled) === '1',
    comment: j.comment ?? '',
    scope: j.scope ?? '',
    enableNew: String(j['enable-new'] ?? '1') === '0' ? '0' : '1',
    removeVanished: parseRemoveVanished(j['remove-vanished']),
  }
}

export function syncJobIdError(id: string): string | null {
  if (!id.trim()) return null // generated
  if (!/^[A-Za-z][A-Za-z0-9\-_]{1,31}$/.test(id.trim())) return '以字母开头，2–32 个字符，只能包含字母、数字、短横线和下划线'
  return null
}

export function validateSyncJobForm(f: SyncJobForm, isCreate: boolean): Partial<Record<'id' | 'realm' | 'schedule' | 'scope', string>> {
  const e: Partial<Record<'id' | 'realm' | 'schedule' | 'scope', string>> = {}
  if (isCreate) {
    const idErr = syncJobIdError(f.id)
    if (idErr) e.id = idErr
    if (!f.realm) e.realm = '请选择认证域'
  }
  if (!f.schedule.trim()) e.schedule = '请填写计划'
  if (!f.scope) e.scope = '请选择同步范围'
  return e
}

/** "realmsync-" + 13 random hex digits, like the official UI. */
export function generateSyncJobId(random: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < 13; i++) s += Math.floor(random() * 16).toString(16)
  return `realmsync-${s.slice(0, 8)}-${s.slice(8)}`
}

function syncJobValues(f: SyncJobForm): ConfigValues {
  return {
    schedule: f.schedule.trim(),
    enabled: f.enabled ? '1' : '0',
    scope: f.scope || null,
    'enable-new': f.enableNew,
    'remove-vanished': stringifyRemoveVanished(f.removeVanished) || 'none',
    comment: txt(f.comment),
  }
}

/** POST /cluster/jobs/realm-sync/{id}: the id goes in the path. */
export function syncJobCreateParams(f: SyncJobForm): { id: string; params: Params } {
  const id = f.id.trim() || generateSyncJobId()
  const params: Params = { realm: f.realm }
  for (const [k, v] of Object.entries(syncJobValues(f))) if (v !== null && v !== undefined) params[k] = v as string
  return { id, params }
}

export function syncJobUpdateParams(before: SyncJob, f: SyncJobForm): Params | null {
  const b: ConfigValues = {
    schedule: before.schedule,
    enabled: before.enabled === undefined ? '1' : String(before.enabled),
    scope: before.scope ?? null,
    'enable-new': before['enable-new'] === undefined ? '1' : String(before['enable-new']),
    'remove-vanished': before['remove-vanished'] || 'none',
    comment: before.comment ?? null,
  }
  const { set, delete: del } = configChanges(b, syncJobValues(f))
  if (Object.keys(set).length === 0 && del.length === 0) return null
  const params: Params = { ...set }
  if (del.length) params.delete = del.join(',')
  if (before.digest) params.digest = before.digest
  return params
}

/** "Run now" of a job: a sync with the job's options (PVE.dc.RealmSyncJobView.runNow). */
export function syncJobRunParams(j: SyncJob): Params {
  return {
    scope: j.scope,
    'enable-new': j['enable-new'],
    'remove-vanished': j['remove-vanished'],
  }
}

// ================================================================= pools

export function poolIdError(id: string, existing: readonly string[] = []): string | null {
  const v = id.trim()
  if (!v) return '请填写名称'
  if (v.split('/').length > 3) return '最多嵌套 3 层（a/b/c）'
  if (!/^[A-Za-z0-9.\-_]+(?:\/[A-Za-z0-9.\-_]+){0,2}$/.test(v)) return '只能包含字母、数字、点、短横线和下划线，嵌套用 /'
  if (existing.includes(v)) return '已有同名资源池'
  const parent = v.includes('/') ? v.slice(0, v.lastIndexOf('/')) : null
  if (parent && existing.length && !existing.includes(parent)) return `上级资源池 ${parent} 不存在`
  return null
}

export function poolCreateParams(poolid: string, comment: string): Params {
  return { poolid: poolid.trim(), comment: comment.trim() || undefined }
}

/** PUT /pools for the comment; null when unchanged. */
export function poolCommentParams(poolid: string, before: string | undefined, comment: string): Params | null {
  if ((before ?? '') === comment.trim()) return null
  return { poolid, comment: comment.trim() }
}

/** PUT /pools to add (allow-move, like the official dialog) or remove members. */
export function poolMembersParams(
  poolid: string,
  members: { vms?: readonly number[]; storage?: readonly string[] },
  mode: 'add' | 'remove',
): Params {
  const params: Params = { poolid }
  if (members.vms?.length) params.vms = members.vms.join(',')
  if (members.storage?.length) params.storage = members.storage.join(',')
  if (mode === 'add') {
    if (members.vms?.length) params['allow-move'] = 1
  } else {
    params.delete = 1
  }
  return params
}

/** Child pools of `poolid` among `all` ("a" → "a/b", "a/b/c"). */
export function childPools(poolid: string, all: readonly string[]): string[] {
  return all.filter((p) => p.startsWith(poolid + '/'))
}

/** Nesting depth (0 for "a", 1 for "a/b"). */
export function poolDepth(poolid: string): number {
  return poolid.split('/').length - 1
}
