// LXC creation wizard: form model, validation and the form → POST
// /nodes/{node}/lxc parameter mapping. Pure logic, no React.
//
// Semantics follow the official wizard (PVE.lxc.CreateWizard): unprivileged
// and nesting on by default, password (≥5) or SSH keys required, rootfs and
// mount points as "<storage>:<GiB>", net0 "name=eth0,bridge=…,ip=dhcp|cidr",
// nameservers space separated.

import type { Params } from '@/api/client'
import { stringifyPropertyString } from '@/lib/propstring'

import {
  isAddressList,
  isDnsName,
  isIPv4,
  isIPv4Cidr,
  isIPv6,
  isIPv6Cidr,
  isMountPath,
  isTag,
  isUnicastMac,
  splitAddressList,
  sshKeysValid,
  type FieldErrors,
} from './validate'

export const LXC_STEPS = [
  { id: 'general', label: '常规' },
  { id: 'template', label: '模板' },
  { id: 'disks', label: '磁盘' },
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: '内存' },
  { id: 'network', label: '网络' },
  { id: 'dns', label: 'DNS' },
  { id: 'confirm', label: '确认' },
] as const

export type LxcStepId = (typeof LXC_STEPS)[number]['id']

/** Mount options the UI offers (rootfs: without nodev/noexec, like the official UI). */
export const MOUNT_OPTIONS = ['discard', 'lazytime', 'noatime', 'nodev', 'noexec', 'nosuid'] as const
export const ROOTFS_MOUNT_OPTIONS = ['discard', 'lazytime', 'noatime', 'nosuid'] as const

export const MP_MAX = 256

export type Ipv4Mode = 'dhcp' | 'static' | 'none'
export type Ipv6Mode = 'none' | 'static' | 'dhcp' | 'auto'

/** '' = storage default, '1' on, '0' off. */
export type AclMode = '' | '1' | '0'

export interface LxcMountPoint {
  key: string
  index: number
  storage: string
  /** GiB */
  size: number | undefined
  path: string
  backup: boolean
  readonly: boolean
  acl: AclMode
  quota: boolean
  mountoptions: string[]
  noReplicate: boolean
}

export interface LxcForm {
  // General
  node: string
  vmid: number | undefined
  hostname: string
  unprivileged: boolean
  nesting: boolean
  pool: string
  tags: string[]
  password: string
  confirmPassword: string
  sshKeys: string
  haManaged: boolean
  // Template
  templateStorage: string
  ostemplate: string
  // Root disk
  rootStorage: string
  /** GiB */
  rootSize: number | undefined
  rootAcl: AclMode
  rootQuota: boolean
  rootMountOptions: string[]
  rootNoReplicate: boolean
  mountPoints: LxcMountPoint[]
  // CPU
  cores: number | undefined
  cpulimit: number | undefined
  cpuunits: number | undefined
  // Memory (MiB)
  memory: number | undefined
  swap: number | undefined
  // Network
  netName: string
  bridge: string
  vlan: number | undefined
  firewall: boolean
  ipv4Mode: Ipv4Mode
  ip: string
  gw: string
  ipv6Mode: Ipv6Mode
  ip6: string
  gw6: string
  hwaddr: string
  mtu: number | undefined
  rate: number | undefined
  disconnect: boolean
  // DNS
  searchdomain: string
  nameserver: string
  // Confirm
  start: boolean
}

let mpSeq = 0

export function freeMpIndexes(form: Pick<LxcForm, 'mountPoints'>, exceptKey?: string): number[] {
  const used = new Set(form.mountPoints.filter((m) => m.key !== exceptKey).map((m) => m.index))
  const out: number[] = []
  for (let i = 0; i < MP_MAX && out.length < 64; i++) if (!used.has(i)) out.push(i)
  return out
}

export function newMountPoint(form: Pick<LxcForm, 'mountPoints'>, storage = ''): LxcMountPoint {
  mpSeq += 1
  const index = freeMpIndexes(form)[0] ?? 0
  return {
    key: `mp-${mpSeq}`,
    index,
    storage,
    size: 8,
    path: `/mnt/data${index === 0 ? '' : index}`,
    backup: true,
    readonly: false,
    acl: '',
    quota: false,
    mountoptions: [],
    noReplicate: false,
  }
}

export function initialLxcForm(node = ''): LxcForm {
  return {
    node,
    vmid: undefined,
    hostname: '',
    unprivileged: true,
    nesting: true,
    pool: '',
    tags: [],
    password: '',
    confirmPassword: '',
    sshKeys: '',
    haManaged: false,
    templateStorage: '',
    ostemplate: '',
    rootStorage: '',
    rootSize: 8,
    rootAcl: '',
    rootQuota: false,
    rootMountOptions: [],
    rootNoReplicate: false,
    mountPoints: [],
    cores: 1,
    cpulimit: undefined,
    cpuunits: undefined,
    memory: 512,
    swap: 512,
    netName: 'eth0',
    bridge: '',
    vlan: undefined,
    firewall: true,
    ipv4Mode: 'dhcp',
    ip: '',
    gw: '',
    ipv6Mode: 'none',
    ip6: '',
    gw6: '',
    hwaddr: '',
    mtu: undefined,
    rate: undefined,
    disconnect: false,
    searchdomain: '',
    nameserver: '',
    start: false,
  }
}

/** Quota needs a privileged container on a non-ZFS storage. */
export function quotaAllowed(unprivileged: boolean, storageType: string | undefined): boolean {
  return !unprivileged && storageType !== 'zfs' && storageType !== 'zfspool'
}

// ------------------------------------------------------------ validation

export interface LxcValidationContext {
  vmidState?: 'checking' | 'free' | 'taken' | 'invalid' | 'unknown'
}

export function validateLxcStep(step: LxcStepId, form: LxcForm, ctx: LxcValidationContext = {}): FieldErrors {
  const e: FieldErrors = {}
  switch (step) {
    case 'general': {
      if (!form.node) e.node = '请选择节点'
      if (form.vmid === undefined) e.vmid = '请输入 CT ID'
      else if (ctx.vmidState === 'taken') e.vmid = `ID ${form.vmid} 已被使用`
      else if (ctx.vmidState === 'invalid' || form.vmid < 100) e.vmid = 'ID 需在 100 到 999999999 之间'
      else if (ctx.vmidState === 'checking') e.vmid = '正在检查 ID 是否可用…'
      if (form.hostname && !isDnsName(form.hostname)) e.hostname = '主机名只能包含字母、数字、连字符和点'
      const bad = form.tags.find((t) => !isTag(t))
      if (bad) e.tags = `标签“${bad}”无效：只能包含字母、数字、_ - + .`
      const keys = form.sshKeys.trim()
      if (keys && !sshKeysValid(keys)) e['ssh-public-keys'] = '无法识别的 SSH 公钥（每行一个）'
      if (!form.password && !keys) e.password = '请设置 root 密码或填写 SSH 公钥'
      else if (form.password && form.password.length < 5) e.password = '密码至少 5 个字符'
      if (form.password && form.confirmPassword !== form.password) e.confirmPassword = '两次输入的密码不一致'
      break
    }
    case 'template':
      if (!form.templateStorage) e.templateStorage = '请选择存储'
      else if (!form.ostemplate) e.ostemplate = '请选择模板'
      break
    case 'disks': {
      if (!form.rootStorage) e.rootfs = '请选择存储'
      else if (form.rootSize === undefined || form.rootSize <= 0) e.rootfs = '请输入根磁盘大小'
      const paths = new Set<string>()
      for (const mp of form.mountPoints) {
        const id = `mp${mp.index}`
        if (!mp.storage) e[id] = '请选择存储'
        else if (mp.size === undefined || mp.size <= 0) e[id] = '请输入大小'
        else if (!isMountPath(mp.path)) e[id] = '挂载路径需为绝对路径，例如 /mnt/data'
        else if (paths.has(mp.path)) e[id] = `路径 ${mp.path} 重复`
        else if (form.mountPoints.some((o) => o !== mp && o.index === mp.index)) e[id] = `${id} 重复`
        paths.add(mp.path)
      }
      break
    }
    case 'cpu':
      if (form.cores !== undefined && (form.cores < 1 || form.cores > 8192)) e.cores = '核心数需在 1 到 8192 之间'
      if (form.cpulimit !== undefined && form.cpulimit < 0) e.cpulimit = 'CPU 限制不能为负数'
      if (form.cpuunits !== undefined && (form.cpuunits < 8 || form.cpuunits > 10000)) e.cpuunits = 'CPU 权重需在 8 到 10000 之间'
      break
    case 'memory':
      if (form.memory === undefined || form.memory < 16) e.memory = '内存至少 16 MiB'
      if (form.swap === undefined || form.swap < 0) e.swap = '请输入交换分区大小（可为 0）'
      break
    case 'network':
      if (!form.netName.trim()) e.netName = '请输入网卡名称'
      else if (!/^[a-zA-Z0-9_.-]{1,15}$/.test(form.netName)) e.netName = '网卡名只能包含字母、数字和 _ . -，最多 15 个字符'
      if (!form.bridge) e.bridge = '请选择网桥'
      if (form.vlan !== undefined && (form.vlan < 1 || form.vlan > 4094)) e.tag = 'VLAN 需在 1 到 4094 之间'
      if (form.ipv4Mode === 'static') {
        if (!isIPv4Cidr(form.ip.trim())) e.ip = '请输入 IPv4/CIDR，例如 192.168.1.20/24'
        if (form.gw.trim() && !isIPv4(form.gw.trim())) e.gw = '网关格式不对'
      }
      if (form.ipv6Mode === 'static') {
        if (!isIPv6Cidr(form.ip6.trim())) e.ip6 = '请输入 IPv6/CIDR，例如 2001:db8::20/64'
        if (form.gw6.trim() && !isIPv6(form.gw6.trim())) e.gw6 = '网关格式不对'
      }
      if (form.hwaddr && !isUnicastMac(form.hwaddr)) e.hwaddr = 'MAC 地址格式不对（需为单播地址）'
      if (form.mtu !== undefined && (form.mtu < 576 || form.mtu > 65535)) e.mtu = 'MTU 需在 576 到 65535 之间'
      break
    case 'dns':
      if (form.searchdomain.trim() && !isDnsName(form.searchdomain.trim())) e.searchdomain = '域名格式不对'
      if (form.nameserver.trim() && !isAddressList(form.nameserver)) e.nameserver = '请输入 IP 地址，多个用空格分隔'
      break
    case 'confirm':
      break
  }
  return e
}

export function lxcStepOfParam(param: string): LxcStepId {
  if (['node', 'vmid', 'hostname', 'unprivileged', 'features', 'pool', 'tags', 'password', 'ssh-public-keys', 'ha-managed'].includes(param))
    return 'general'
  if (['ostemplate', 'templateStorage'].includes(param)) return 'template'
  if (param === 'rootfs' || /^mp\d+$/.test(param)) return 'disks'
  if (['cores', 'cpulimit', 'cpuunits'].includes(param)) return 'cpu'
  if (['memory', 'swap'].includes(param)) return 'memory'
  if (/^net\d+$/.test(param)) return 'network'
  if (['nameserver', 'searchdomain'].includes(param)) return 'dns'
  return 'confirm'
}

// --------------------------------------------------------------- params

export function rootfsParam(form: LxcForm): string {
  return stringifyPropertyString(
    {
      volume: `${form.rootStorage}:${form.rootSize ?? 0}`,
      acl: form.rootAcl || undefined,
      quota: form.rootQuota && !form.unprivileged ? 1 : undefined,
      mountoptions: form.rootMountOptions.filter((o) => (ROOTFS_MOUNT_OPTIONS as readonly string[]).includes(o)),
      replicate: form.rootNoReplicate ? 0 : undefined,
    },
    'volume',
  )
}

export function mountPointParam(mp: LxcMountPoint, unprivileged: boolean): string {
  return stringifyPropertyString(
    {
      volume: `${mp.storage}:${mp.size ?? 0}`,
      mp: mp.path,
      backup: mp.backup ? 1 : undefined,
      ro: mp.readonly ? 1 : undefined,
      acl: mp.acl || undefined,
      quota: mp.quota && !unprivileged ? 1 : undefined,
      mountoptions: mp.mountoptions,
      replicate: mp.noReplicate ? 0 : undefined,
    },
    'volume',
  )
}

export function lxcNetParam(form: LxcForm): string {
  const ip = form.ipv4Mode === 'dhcp' ? 'dhcp' : form.ipv4Mode === 'static' ? form.ip.trim() : undefined
  const ip6 =
    form.ipv6Mode === 'dhcp' ? 'dhcp' : form.ipv6Mode === 'auto' ? 'auto' : form.ipv6Mode === 'static' ? form.ip6.trim() : undefined
  return stringifyPropertyString({
    name: form.netName.trim(),
    bridge: form.bridge,
    hwaddr: form.hwaddr ? form.hwaddr.toUpperCase() : undefined,
    tag: form.vlan,
    firewall: form.firewall ? 1 : undefined,
    ip,
    gw: form.ipv4Mode === 'static' ? form.gw.trim() || undefined : undefined,
    ip6,
    gw6: form.ipv6Mode === 'static' ? form.gw6.trim() || undefined : undefined,
    mtu: form.mtu,
    rate: form.rate || undefined,
    link_down: form.disconnect ? 1 : undefined,
  })
}

/** All parameters of POST /nodes/{node}/lxc. */
export function buildLxcParams(form: LxcForm): Params {
  const keys = form.sshKeys
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
  const params: Params = {
    vmid: form.vmid,
    hostname: form.hostname.trim() || undefined,
    unprivileged: form.unprivileged ? 1 : 0,
    features: form.unprivileged && form.nesting ? 'nesting=1' : undefined,
    pool: form.pool || undefined,
    tags: form.tags.length ? form.tags.join(';') : undefined,
    password: form.password || undefined,
    'ssh-public-keys': keys ? `${keys}\n` : undefined,
    'ha-managed': form.haManaged ? 1 : undefined,
    ostemplate: form.ostemplate,
    rootfs: rootfsParam(form),
    cores: form.cores,
    cpulimit: form.cpulimit ? form.cpulimit : undefined,
    cpuunits: form.cpuunits,
    memory: form.memory,
    swap: form.swap,
    net0: lxcNetParam(form),
    searchdomain: form.searchdomain.trim() || undefined,
    nameserver: form.nameserver.trim() ? splitAddressList(form.nameserver).join(' ') : undefined,
    start: form.start ? 1 : undefined,
  }
  for (const mp of form.mountPoints) params[`mp${mp.index}`] = mountPointParam(mp, form.unprivileged)
  for (const k of Object.keys(params)) if (params[k] === undefined || params[k] === '') delete params[k]
  return params
}
