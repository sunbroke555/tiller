// Form values → config parameters, following the official editors
// (pvemanagerlib.js onGetValues). Pure functions, unit tested.

import type { Params } from '@/api/client'
import {
  configUpdateParams,
  parseDrive,
  parsePropertyString,
  stringifyPropertyString,
  stringifyQemuNet,
  tryParsePropertyString,
  type PropertyValue,
} from '@/lib/propstring'

import { BACKEND_CPU, type Arch } from './constants'
import { guestArch, parseCpu, parseMemory, stringifyCpuFlags, type Config } from './model'

type Values = Record<string, string | number | boolean | null | undefined>

const str = (v: number | string | undefined | null) => (v === undefined || v === null ? '' : String(v))

/** Config update params (changed keys, delete list, digest) or null when nothing changed. */
export function updateParams(cfg: Config, after: Values, digest: string | undefined): Params | null {
  return configUpdateParams(cfg, after, { digest })
}

// ---------------------------------------------------------------- memory

export interface MemoryForm {
  /** MiB */
  memory: number
  ballooning: boolean
  /** Minimum memory (MiB) when ballooning. */
  balloon: number | undefined
  shares: number | undefined
  allowKsm: boolean
}

export function memoryFormFrom(cfg: Config): MemoryForm {
  const memory = parseMemory(cfg.memory)
  const balloon = cfg.balloon === undefined ? undefined : Number(cfg.balloon)
  return {
    memory,
    ballooning: balloon !== 0,
    balloon: balloon && balloon > 0 ? balloon : memory,
    shares: cfg.shares ? Number(cfg.shares) : undefined,
    allowKsm: cfg['allow-ksm'] !== '0',
  }
}

export function memoryValues(cfg: Config, f: MemoryForm): Values {
  // Keep the PVE 9 "current=…" form when the config uses it.
  const memory = cfg.memory && cfg.memory.includes('=')
    ? stringifyPropertyString({ ...tryParsePropertyString(cfg.memory, 'current'), current: f.memory })
    : String(f.memory)
  const out: Values = { memory, 'allow-ksm': f.allowKsm ? '' : '0' }
  if (!f.ballooning) {
    out.balloon = '0'
    out.shares = ''
  } else if (f.balloon === undefined || f.balloon === f.memory) {
    out.balloon = ''
    out.shares = ''
  } else {
    out.balloon = String(f.balloon)
    out.shares = str(f.shares)
  }
  return out
}

// ------------------------------------------------------------- processor

export interface ProcessorForm {
  sockets: number
  cores: number
  /** CPU model; undefined = backend default (aarch64 only). */
  cputype: string | undefined
  flags: Record<string, '+' | '-' | undefined>
  vcpus: number | undefined
  cpulimit: number | undefined
  cpuunits: number | undefined
  affinity: string
  numa: boolean
}

export function processorFormFrom(cfg: Config, arch: Arch): ProcessorForm {
  const cpu = parseCpu(cfg.cpu)
  const flags: Record<string, '+' | '-'> = {}
  for (const f of (cpu.flags ?? '').split(';')) {
    if ((f[0] === '+' || f[0] === '-') && f.length > 1) flags[f.slice(1)] = f[0]
  }
  return {
    sockets: Number(cfg.sockets ?? 1) || 1,
    cores: Number(cfg.cores ?? 1) || 1,
    // Unset on x86 means the backend default kvm64 (the official editor shows it explicitly).
    cputype: cpu.cputype ?? (arch === 'x86_64' ? 'kvm64' : undefined),
    flags,
    vcpus: cfg.vcpus ? Number(cfg.vcpus) : undefined,
    cpulimit: cfg.cpulimit ? Number(cfg.cpulimit) : undefined,
    cpuunits: cfg.cpuunits ? Number(cfg.cpuunits) : undefined,
    affinity: cfg.affinity ?? '',
    numa: cfg.numa === '1',
  }
}

/** cpuunits default: 1024 on cgroup v1, 100 on v2. */
export function processorValues(cfg: Config, f: ProcessorForm, cpuunitsDefault = 100): Values {
  const old = parseCpu(cfg.cpu)
  const flags = stringifyCpuFlags(f.flags)
  const props: Record<string, PropertyValue> = { ...old, cputype: f.cputype, flags: flags || undefined }
  let cpu = stringifyPropertyString(props, 'cputype')
  // Options without a model need one in front (printQemuCpu): the backend
  // default of the guest's architecture (kvm64 would not start on aarch64).
  const fallback = BACKEND_CPU[guestArch(cfg)]
  if (cpu && !f.cputype) cpu = `${fallback},${cpu}`
  // An unset cpu means the backend default: do not write the explicit form back.
  if (!cfg.cpu && cpu === fallback) cpu = ''
  // Unset sockets/cores mean 1: keep them unset.
  const count = (key: 'sockets' | 'cores', n: number) => (n === 1 && cfg[key] === undefined ? '' : String(n))
  return {
    sockets: count('sockets', f.sockets),
    cores: count('cores', f.cores),
    cpu,
    vcpus: str(f.vcpus),
    cpulimit: f.cpulimit ? String(f.cpulimit) : '',
    cpuunits: f.cpuunits && f.cpuunits !== cpuunitsDefault ? String(f.cpuunits) : '',
    affinity: f.affinity.trim(),
    numa: f.numa ? '1' : '',
  }
}

// -------------------------------------------------------- display / machine

export function displayValue(type: string | undefined, memory: number | undefined, clipboard: string | undefined): string {
  return stringifyPropertyString({ type, memory, clipboard }, 'type')
}

export interface MachineForm {
  /** '' default, 'q35', or a pinned machine id (pc-q35-9.2+pve1). */
  type: string
  viommu: string | undefined
  awBits: number | undefined
  enableS3: boolean | undefined
  enableS4: boolean | undefined
}

export function machineFormFrom(cfg: Config): MachineForm {
  const m = tryParsePropertyString(cfg.machine, 'type')
  const type = m.type === 'pc' ? '' : (m.type ?? '')
  return {
    type,
    viommu: m.viommu,
    awBits: m['aw-bits'] ? Number(m['aw-bits']) : undefined,
    enableS3: m['enable-s3'] === undefined ? undefined : m['enable-s3'] === '1',
    enableS4: m['enable-s4'] === undefined ? undefined : m['enable-s4'] === '1',
  }
}

export function machineValue(cfg: Config, f: MachineForm, arch: Arch): string {
  const old = tryParsePropertyString(cfg.machine, 'type')
  let type: string | undefined = f.type || undefined
  const extras = f.viommu || f.awBits || f.enableS3 !== undefined || f.enableS4 !== undefined
  // Options need an explicit type: the default machine is "pc" (x86) or "virt".
  if (!type && extras) type = arch === 'aarch64' ? 'virt' : 'pc'
  return stringifyPropertyString(
    {
      ...old,
      type,
      viommu: f.viommu,
      'aw-bits': f.awBits,
      'enable-s3': f.enableS3,
      'enable-s4': f.enableS4,
    },
    'type',
  )
}

// ------------------------------------------------------------------ disks

export interface DiskOptions {
  cache: string | undefined
  discard: boolean
  iothread: boolean
  ssd: boolean
  readonly: boolean
  backup: boolean
  replicate: boolean
  aio: string | undefined
  mbps_rd?: number
  mbps_wr?: number
  iops_rd?: number
  iops_wr?: number
  mbps_rd_max?: number
  mbps_wr_max?: number
  iops_rd_max?: number
  iops_wr_max?: number
}

export const LIMIT_KEYS = ['mbps_rd', 'mbps_wr', 'iops_rd', 'iops_wr', 'mbps_rd_max', 'mbps_wr_max', 'iops_rd_max', 'iops_wr_max'] as const

const on = (v: string | undefined) => v === '1' || v === 'on' || v === 'yes' || v === 'true'

export function diskOptionsFrom(value: string | undefined, defaults: Partial<DiskOptions> = {}): DiskOptions {
  const d = parseDrive(value)
  const opts: DiskOptions = {
    cache: d.cache,
    discard: d.discard === 'on',
    iothread: value ? on(d.iothread) : (defaults.iothread ?? false),
    ssd: on(d.ssd),
    readonly: on(d.ro),
    backup: d.backup === undefined ? true : on(d.backup),
    replicate: d.replicate === undefined ? true : on(d.replicate),
    aio: d.aio,
  }
  for (const k of LIMIT_KEYS) {
    if (d[k] !== undefined && d[k] !== '') opts[k] = Number(d[k])
  }
  return opts
}

function applyDiskOptions(drive: Record<string, PropertyValue>, o: DiskOptions, bus: string): Record<string, PropertyValue> {
  const out = { ...drive }
  out.cache = o.cache
  out.discard = o.discard ? 'on' : undefined
  // IO thread only on VirtIO and SCSI; SSD emulation not on VirtIO Block; ro on VirtIO/SCSI.
  out.iothread = o.iothread && (bus === 'virtio' || bus === 'scsi') ? '1' : undefined
  out.ssd = o.ssd && bus !== 'virtio' ? '1' : undefined
  out.ro = o.readonly && (bus === 'virtio' || bus === 'scsi') ? '1' : undefined
  out.backup = o.backup ? undefined : '0'
  out.replicate = o.replicate ? undefined : '0'
  out.aio = o.aio
  for (const k of LIMIT_KEYS) out[k] = o[k]
  return out
}

/** New disk: "<storage>:<GiB>[,format=…][,options]". */
export function newDiskValue(storage: string, sizeGiB: number, format: string | undefined, bus: string, o: DiskOptions): string {
  return stringifyPropertyString(applyDiskOptions({ file: `${storage}:${sizeGiB}`, format }, o, bus), 'file')
}

/** Import: "<target storage>:0,import-from=<volid>[,format=…][,options]". */
export function importDiskValue(storage: string, source: string, format: string | undefined, bus: string, o: DiskOptions): string {
  return stringifyPropertyString(
    applyDiskOptions({ file: `${storage}:0`, 'import-from': source, format }, o, bus),
    'file',
  )
}

/** Existing disk (or re-attached unused volume): change options, keep the rest. */
export function editDiskValue(value: string, bus: string, o: DiskOptions): string {
  return stringifyPropertyString(applyDiskOptions(parsePropertyString(value, 'file'), o, bus), 'file')
}

// --------------------------------------------------------------- CD-ROM

export type CdMedia = 'iso' | 'cdrom' | 'none'

export function cdromValue(old: string | undefined, media: CdMedia, iso: string | undefined): string {
  const drive = tryParsePropertyString(old, 'file')
  const file = media === 'iso' ? iso : media === 'cdrom' ? 'cdrom' : 'none'
  return stringifyPropertyString({ ...drive, file, media: 'cdrom' }, 'file')
}

// --------------------------------------------------------------- network

export interface NetForm {
  model: string
  macaddr: string
  bridge: string | undefined
  tag: number | undefined
  firewall: boolean
  disconnect: boolean
  rate: number | undefined
  queues: number | undefined
  mtu: number | undefined
  trunks: string
}

export function netValue(oldOptions: Record<string, string>, f: NetForm): string {
  const options: Record<string, string> = { ...oldOptions }
  const set = (k: string, v: string | number | boolean | undefined) => {
    if (v === undefined || v === '' || v === false) delete options[k]
    else options[k] = v === true ? '1' : String(v)
  }
  set('bridge', f.bridge)
  set('tag', f.tag)
  set('firewall', f.firewall)
  set('link_down', f.disconnect)
  set('rate', f.rate)
  set('queues', f.queues)
  set('mtu', f.mtu)
  set('trunks', f.trunks.trim().replace(/[,\s]+/g, ';'))
  return stringifyQemuNet({ model: f.model, macaddr: f.macaddr.trim().toUpperCase(), options })
}

// ---------------------------------------------------------------- devices

export type UsbMode = 'spice' | 'mapped' | 'device' | 'port'

export function usbValue(mode: UsbMode, id: string | undefined, usb3: boolean): string {
  let base: string
  switch (mode) {
    case 'spice':
      base = 'spice'
      break
    case 'mapped':
      base = `mapping=${id ?? ''}`
      break
    default:
      base = `host=${id ?? ''}`
  }
  return usb3 ? `${base},usb3=1` : base
}

export function parseUsb(value: string | undefined): { mode: UsbMode; id: string; usb3: boolean } {
  if (!value) return { mode: 'spice', id: '', usb3: true }
  const u = tryParsePropertyString(value, 'host')
  const usb3 = on(u.usb3)
  if (u.mapping) return { mode: 'mapped', id: u.mapping, usb3 }
  if (!u.host || u.host === 'spice') return { mode: 'spice', id: '', usb3 }
  if (/^[0-9a-f]{4}:[0-9a-f]{4}$/i.test(u.host)) return { mode: 'device', id: u.host.toLowerCase(), usb3 }
  return { mode: 'port', id: u.host, usb3 }
}

export interface PciForm {
  mode: 'mapped' | 'raw'
  mapping: string | undefined
  /** "0000:01:00.0" */
  host: string | undefined
  allFunctions: boolean
  mdev: string | undefined
  primaryGpu: boolean
  rombar: boolean
  pcie: boolean
  vendorId: string
  deviceId: string
  subVendorId: string
  subDeviceId: string
}

export function pciFormFrom(value: string | undefined): PciForm {
  const h = tryParsePropertyString(value, 'host')
  let host = h.host
  let allFunctions = false
  if (host) {
    if (!/^[0-9a-f]{4}:/i.test(host)) host = `0000:${host}`
    if (host.length < 11) {
      host += '.0'
      allFunctions = true
    }
  }
  return {
    mode: h.host ? 'raw' : 'mapped',
    mapping: h.mapping,
    host,
    allFunctions,
    mdev: h.mdev,
    primaryGpu: on(h['x-vga']),
    rombar: h.rombar === undefined ? true : on(h.rombar),
    pcie: on(h.pcie),
    vendorId: h['vendor-id'] ?? '',
    deviceId: h['device-id'] ?? '',
    subVendorId: h['sub-vendor-id'] ?? '',
    subDeviceId: h['sub-device-id'] ?? '',
  }
}

export function pciValue(old: string | undefined, f: PciForm): string {
  const prev = tryParsePropertyString(old, 'host')
  let host: string | undefined
  if (f.mode === 'raw' && f.host) {
    host = f.host.replace(/^0000:/, '')
    if (f.allFunctions && !f.mdev) host = host.replace(/\.\d+$/, '')
  }
  return stringifyPropertyString(
    {
      ...prev,
      host,
      mapping: f.mode === 'mapped' ? f.mapping : undefined,
      mdev: f.mdev,
      'x-vga': f.primaryGpu || undefined,
      pcie: f.pcie || undefined,
      rombar: f.rombar ? undefined : 0,
      'vendor-id': f.vendorId.trim(),
      'device-id': f.deviceId.trim(),
      'sub-vendor-id': f.subVendorId.trim(),
      'sub-device-id': f.subDeviceId.trim(),
    },
    'host',
  )
}

const truthy = (v: unknown) => v === 1 || v === true || v === '1'

/**
 * Where the "MDev 类型" list comes from (GET /nodes/{node}/hardware/pci/{id}/mdev):
 * the raw device when it supports mediated devices, or the mapping id when
 * the cluster mapping is marked mdev=1 (official PCIInputPanel.pciDevChange).
 */
export function pciMdevSource(
  f: Pick<PciForm, 'mode' | 'host' | 'mapping'>,
  devices: readonly { id: string; mdev?: unknown }[] | undefined,
  mappings: readonly { id: string; mdev?: unknown }[] | undefined,
): string | undefined {
  if (f.mode === 'raw') return f.host && truthy(devices?.find((d) => d.id === f.host)?.mdev) ? f.host : undefined
  return f.mapping && truthy(mappings?.find((m) => m.id === f.mapping)?.mdev) ? f.mapping : undefined
}

export function rngValue(source: string, maxBytes: number | undefined, period: number | undefined): string {
  // Empty limit = unlimited (0); the default 1024/1000 is left out.
  let max: number | undefined = maxBytes === undefined ? 0 : maxBytes
  if (max === 1024 && period === undefined) max = undefined
  return stringifyPropertyString({ source, max_bytes: max === 0 ? '0' : max, period }, 'source')
}

export interface VirtiofsForm {
  dirid: string
  cache: string | undefined
  xattr: boolean
  acl: boolean
  directIo: boolean
}

export function virtiofsValue(f: VirtiofsForm): string {
  return stringifyPropertyString(
    {
      dirid: f.dirid,
      cache: f.cache,
      'expose-xattr': f.xattr && !f.acl ? 1 : undefined,
      'expose-acl': f.acl ? 1 : undefined,
      'direct-io': f.directIo ? 1 : undefined,
    },
    'dirid',
  )
}

// ---------------------------------------------------------------- options

export interface StartupForm {
  order: number | undefined
  up: number | undefined
  down: number | undefined
}

export function startupValue(f: StartupForm): string {
  return stringifyPropertyString({ order: f.order, up: f.up, down: f.down })
}

/** hotplug: "disk,network,usb" (default) | "0" (off) | list; "1" means the default set. */
export function parseHotplug(value: string | undefined): string[] {
  if (value === undefined || value === '' || value === '1') return ['disk', 'network', 'usb']
  if (value === '0') return []
  return value.split(',').filter(Boolean)
}

export function hotplugValue(features: readonly string[]): string {
  const order = ['disk', 'network', 'usb', 'memory', 'cpu']
  const list = order.filter((f) => features.includes(f))
  if (list.length === 0) return '0'
  if (list.join(',') === 'disk,network,usb') return ''
  return list.join(',')
}

export interface AgentForm {
  enabled: boolean
  fstrim: boolean
  freezeFs: boolean
  type: string | undefined
}

export function agentFormFrom(value: string | undefined): AgentForm {
  const a = tryParsePropertyString(value, 'enabled')
  const freeze = a['freeze-fs'] ?? a['freeze-fs-on-backup']
  return {
    enabled: on(a.enabled),
    fstrim: on(a.fstrim_cloned_disks),
    freezeFs: freeze === undefined ? true : on(freeze),
    type: a.type,
  }
}

export function agentValue(old: string | undefined, f: AgentForm): string {
  const prev = tryParsePropertyString(old, 'enabled')
  delete prev['freeze-fs-on-backup']
  return stringifyPropertyString(
    {
      ...prev,
      enabled: f.enabled ? '1' : '0',
      fstrim_cloned_disks: f.fstrim ? '1' : undefined,
      'freeze-fs': f.freezeFs ? undefined : '0',
      type: f.type,
    },
    'enabled',
  )
}

/** smbios1: values other than uuid are base64 encoded (base64=1), like the official editor. */
export const SMBIOS_FIELDS = ['uuid', 'manufacturer', 'product', 'version', 'serial', 'sku', 'family'] as const
export type SmbiosForm = Record<(typeof SMBIOS_FIELDS)[number], string>

function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function b64decode(s: string): string {
  try {
    const bin = atob(s)
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return s
  }
}

export function parseSmbios(value: string | undefined): SmbiosForm & { rest: Record<string, string> } {
  const raw: Record<string, string> = {}
  for (const part of (value ?? '').split(',')) {
    const i = part.indexOf('=')
    if (i > 0) raw[part.slice(0, i)] = part.slice(i + 1)
  }
  const base64 = on(raw.base64)
  const out = { rest: {} as Record<string, string> } as SmbiosForm & { rest: Record<string, string> }
  for (const f of SMBIOS_FIELDS) {
    const v = raw[f] ?? ''
    out[f] = base64 && f !== 'uuid' && v ? b64decode(v) : v
  }
  for (const [k, v] of Object.entries(raw)) {
    if (!(SMBIOS_FIELDS as readonly string[]).includes(k) && k !== 'base64') out.rest[k] = v
  }
  return out
}

export function smbiosValue(f: SmbiosForm, rest: Record<string, string> = {}): string {
  const parts: string[] = []
  let base64 = false
  for (const k of SMBIOS_FIELDS) {
    const v = f[k].trim()
    if (!v) continue
    if (k === 'uuid') parts.push(`uuid=${v}`)
    else {
      base64 = true
      parts.push(`${k}=${b64encode(v)}`)
    }
  }
  for (const [k, v] of Object.entries(rest)) parts.push(`${k}=${v}`)
  if (base64) parts.push('base64=1')
  return parts.join(',')
}

export interface SpiceForm {
  foldersharing: boolean
  videostreaming: string
}

export function spiceValue(f: SpiceForm): string {
  return stringifyPropertyString({
    foldersharing: f.foldersharing ? 1 : undefined,
    videostreaming: f.videostreaming !== 'off' ? f.videostreaming : undefined,
  })
}

export interface SevForm {
  type: string | undefined
  debug: boolean
  keySharing: boolean
  smt: boolean
  kernelHashes: boolean
}

export function sevFormFrom(value: string | undefined): SevForm {
  const s = tryParsePropertyString(value, 'type')
  return {
    type: s.type,
    debug: !on(s['no-debug']),
    keySharing: !on(s['no-key-sharing']),
    smt: s['allow-smt'] === undefined ? true : on(s['allow-smt']),
    kernelHashes: on(s['kernel-hashes']),
  }
}

export function sevValue(f: SevForm): string {
  if (!f.type) return ''
  return stringifyPropertyString(
    {
      type: f.type,
      'no-debug': f.debug ? undefined : 1,
      'no-key-sharing': f.keySharing || f.type === 'snp' ? undefined : 1,
      'allow-smt': f.type === 'snp' && !f.smt ? 0 : undefined,
      'kernel-hashes': f.kernelHashes ? 1 : undefined,
    },
    'type',
  )
}

export interface TdxForm {
  enabled: boolean
  attestation: boolean
  cid: number | undefined
  port: number | undefined
}

export function tdxFormFrom(value: string | undefined): TdxForm {
  const t = tryParsePropertyString(value, 'type')
  return {
    enabled: t.type === 'tdx',
    attestation: t.attestation === undefined ? true : on(t.attestation),
    cid: t['vsock-cid'] ? Number(t['vsock-cid']) : 2,
    port: t['vsock-port'] ? Number(t['vsock-port']) : 4050,
  }
}

export function tdxValue(f: TdxForm): string {
  if (!f.enabled) return ''
  return stringifyPropertyString(
    {
      type: 'tdx',
      attestation: f.attestation ? 1 : 0,
      'vsock-cid': f.attestation ? f.cid : undefined,
      'vsock-port': f.attestation ? f.port : undefined,
    },
    'type',
  )
}

// ---------------------------------------------------------------- boot order

export interface BootDevice {
  key: string
  enabled: boolean
  /** Config value (for the icon / description). */
  value: string
}

function isBootable(key: string, value: string): boolean {
  if (/^(ide|sata|scsi|virtio)\d+$/.test(key)) return !/vm-\d+-cloudinit/.test(value)
  if (/^net\d+$/.test(key) || /^hostpci\d+$/.test(key)) return true
  return /^usb\d+$/.test(key) && !/spice/.test(value)
}

const naturalKey = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** Boot devices in boot order, then the remaining bootable devices (disabled). */
export function bootDevices(cfg: Config): BootDevice[] {
  const boot = tryParsePropertyString(cfg.boot, 'legacy')
  const order: string[] = []
  if (boot.order !== undefined) {
    order.push(...boot.order.split(';').filter(Boolean))
  } else if (cfg.boot === undefined || !/^\s*$/.test(cfg.boot)) {
    // Legacy "cdn" letters: c = bootdisk, d = CD-ROMs, n = NICs.
    for (const letter of (boot.legacy ?? 'cdn').split('').slice(0, 4)) {
      const list: string[] = []
      for (const [k, v] of Object.entries(cfg)) {
        if (letter === 'c' && k === cfg.bootdisk && cfg[k] !== undefined) list.push(k)
        if (letter === 'd' && /^(ide|sata|scsi|virtio)\d+$/.test(k) && /media=cdrom/.test(v) && !/vm-\d+-cloudinit/.test(v)) list.push(k)
        if (letter === 'n' && /^net\d+$/.test(k)) list.push(k)
      }
      order.push(...list.sort(naturalKey))
    }
  }
  const devices: BootDevice[] = order
    .filter((k, i) => order.indexOf(k) === i)
    .map((key) => ({ key, enabled: true, value: cfg[key] ?? '' }))
  const rest = Object.entries(cfg)
    .filter(([k, v]) => isBootable(k, v) && !order.includes(k))
    .map(([k]) => k)
    .sort(naturalKey)
  for (const key of rest) devices.push({ key, enabled: false, value: cfg[key] ?? '' })
  return devices
}

export function bootValue(devices: readonly BootDevice[]): string {
  return `order=${devices.filter((d) => d.enabled).map((d) => d.key).join(';')}`
}

// ---------------------------------------------------------------- cloud-init

export interface IpConfigForm {
  ipv4: 'none' | 'dhcp' | 'static'
  ip: string
  gw: string
  ipv6: 'none' | 'dhcp' | 'auto' | 'static'
  ip6: string
  gw6: string
}

export function ipConfigFormFrom(value: string | undefined): IpConfigForm {
  const c = tryParsePropertyString(value)
  const ipv4 = c.ip === 'dhcp' ? 'dhcp' : c.ip ? 'static' : 'none'
  const ipv6 = c.ip6 === 'dhcp' || c.ip6 === 'auto' ? c.ip6 : c.ip6 ? 'static' : 'none'
  return {
    ipv4,
    ip: ipv4 === 'static' ? (c.ip ?? '') : '',
    gw: c.gw ?? '',
    ipv6,
    ip6: ipv6 === 'static' ? (c.ip6 ?? '') : '',
    gw6: c.gw6 ?? '',
  }
}

export function ipConfigValue(f: IpConfigForm): string {
  return stringifyPropertyString({
    ip: f.ipv4 === 'static' ? f.ip.trim() : f.ipv4 === 'dhcp' ? 'dhcp' : undefined,
    gw: f.ipv4 === 'static' ? f.gw.trim() : undefined,
    ip6: f.ipv6 === 'static' ? f.ip6.trim() : f.ipv6 === 'none' ? undefined : f.ipv6,
    gw6: f.ipv6 === 'static' ? f.gw6.trim() : undefined,
  })
}

/** sshkeys are stored URL-encoded; the official UI encodes with encodeURIComponent. */
export function encodeSshKeys(keys: string): string {
  const trimmed = keys.trim()
  return trimmed ? encodeURIComponent(`${trimmed}\n`) : ''
}

export function decodeSshKeys(value: string | undefined): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Short labels for the keys in an ssh authorized_keys text (comment or type + key head). */
export function sshKeyLabels(keys: string): string[] {
  return keys
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((line) => {
      const m = /(?:^|\s)((?:sk-)?(?:ssh-(?:rsa|dss|ed25519)|ecdsa-sha2-nistp\d+)(?:@[\w.-]+)?)\s+(\S+)(?:\s+(.*))?$/.exec(line)
      if (!m) return line.length > 40 ? `${line.slice(0, 40)}…` : line
      return m[3]?.trim() || `${m[1]} …${m[2]!.slice(-8)}`
    })
}

/** cicustom "user=local:snippets/u.yaml,network=…" → entries. */
export function parseCicustom(value: string | undefined): [string, string][] {
  return Object.entries(tryParsePropertyString(value))
}
