// Pure logic of the resource mappings and custom CPU models: the per-node
// map property strings, form → API parameters, and the "does this entry
// still match the host" checks (the same comparisons the official UI does).

import type { Params } from '@/api/client'
import type { HostPciDevice, HostUsbDevice } from '@/api/qemu-config'
import type { ClusterMapping, CustomCpuModel, MappingCheck } from '@/api/resource-mappings'
import { configUpdateParams, parseListValue, stringifyPropertyString, tryParsePropertyString } from '@/lib/propstring'

// ------------------------------------------------------------ map entries

/** One parsed `map` entry: "node=pve1,path=0000:01:00.0,id=10de:1eb8,iommugroup=12". */
export interface MapItem {
  node: string
  path?: string
  id?: string
  'subsystem-id'?: string
  iommugroup?: string
  description?: string
  /** The property string as stored (used to remove exactly this entry). */
  raw: string
}

export function parseMapItem(raw: string): MapItem {
  const props = tryParsePropertyString(raw)
  return { ...props, node: props.node ?? '', raw }
}

export interface NodeGroup {
  node: string
  items: MapItem[]
}

/** Entries grouped by node (nodes sorted, entries in stored order). */
export function groupByNode(map: readonly string[] | undefined): NodeGroup[] {
  const groups = new Map<string, MapItem[]>()
  for (const raw of map ?? []) {
    const item = parseMapItem(raw)
    const list = groups.get(item.node) ?? []
    list.push(item)
    groups.set(item.node, list)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([node, items]) => ({ node, items }))
}

export function mappedNodes(map: readonly string[] | undefined): string[] {
  return groupByNode(map).map((g) => g.node)
}

/** Replace the entries of `node` with `entries`; other nodes' entries keep their order. */
export function replaceNodeEntries(map: readonly string[] | undefined, node: string, entries: readonly string[]): string[] {
  return [...(map ?? []).filter((raw) => parseMapItem(raw).node !== node), ...entries]
}

export function removeNodeEntries(map: readonly string[] | undefined, node: string): string[] {
  return replaceNodeEntries(map, node, [])
}

export function removeEntry(map: readonly string[] | undefined, raw: string): string[] {
  return (map ?? []).filter((r) => r !== raw)
}

/**
 * Removing entries of a mapping: PUT the remaining map, or DELETE the whole
 * mapping when nothing would be left (PVE needs at least one entry).
 */
export function removalRequest(mapping: ClusterMapping, remaining: string[]): { method: 'PUT'; params: Params } | { method: 'DELETE' } {
  if (remaining.length === 0) return { method: 'DELETE' }
  const params: Params = { map: remaining }
  if (mapping.digest) params.digest = mapping.digest
  return { method: 'PUT', params }
}

// ------------------------------------------------------------- PCI devices

const hex = (v: string | undefined) => v?.replace(/0x/gi, '').toLowerCase()

/** "10de:1eb8" from a host PCI device. */
export function pciDeviceId(dev: Pick<HostPciDevice, 'vendor' | 'device'>): string {
  return `${hex(dev.vendor)}:${hex(dev.device)}`
}

export function pciSubsystemId(dev: Pick<HostPciDevice, 'subsystem_vendor' | 'subsystem_device'>): string | undefined {
  if (!dev.subsystem_vendor || !dev.subsystem_device) return undefined
  return `${hex(dev.subsystem_vendor)}:${hex(dev.subsystem_device)}`
}

/** A selectable row of the PCI picker: a function ("0000:01:00.0") or a whole multi-function slot ("0000:01:00"). */
export interface PciChoice extends HostPciDevice {
  /** True for the virtual "all functions" row of a multi-function device. */
  slot?: boolean
  /** Number of functions in this device's slot. */
  functions: number
}

const slotOf = (id: string) => id.replace(/\.[0-9a-f]$/i, '')

/**
 * Host devices plus one "all functions" row per multi-function slot (placed
 * before its functions), like the official picker. The slot row carries the
 * attributes of function .0.
 */
export function pciChoices(devices: readonly HostPciDevice[] | undefined): PciChoice[] {
  const list = [...(devices ?? [])].sort((a, b) => a.id.localeCompare(b.id))
  const counts = new Map<string, number>()
  for (const d of list) counts.set(slotOf(d.id), (counts.get(slotOf(d.id)) ?? 0) + 1)
  const out: PciChoice[] = []
  const added = new Set<string>()
  for (const d of list) {
    const slot = slotOf(d.id)
    const functions = counts.get(slot) ?? 1
    if (functions > 1 && !added.has(slot)) {
      added.add(slot)
      const first = list.find((x) => x.id === `${slot}.0`) ?? d
      out.push({ ...first, id: slot, slot: true, functions, mdev: undefined })
    }
    out.push({ ...d, functions })
  }
  return out
}

/** Map entry for a picked PCI device on `node`. */
export function pciMapEntry(node: string, dev: HostPciDevice): string {
  return stringifyPropertyString({
    node,
    path: dev.id,
    id: pciDeviceId(dev),
    'subsystem-id': pciSubsystemId(dev),
    iommugroup: dev.iommugroup !== -1 && dev.iommugroup !== undefined ? dev.iommugroup : undefined,
  })
}

/**
 * Map entries for the picked paths. A path the host no longer reports keeps
 * its stored entry (so editing other devices does not drop it).
 */
export function pciMapEntries(node: string, paths: readonly string[], choices: readonly PciChoice[], previous: readonly MapItem[] = []): string[] {
  const out: string[] = []
  for (const path of paths) {
    const dev = choices.find((c) => c.id === path)
    if (dev) out.push(pciMapEntry(node, dev))
    else {
      const old = previous.find((i) => i.path === path)
      if (old) out.push(old.raw)
    }
  }
  return out
}

/** Picking a whole slot makes its single functions redundant: drop them. */
export function normalizePciSelection(paths: readonly string[]): string[] {
  const slots = new Set(paths.filter((p) => !/\.[0-9a-f]$/i.test(p)))
  return paths.filter((p) => !(/\.[0-9a-f]$/i.test(p) && slots.has(slotOf(p))))
}

/** No IOMMU on the host: every device reports group -1. */
export function iommuMissing(devices: readonly HostPciDevice[] | undefined): boolean {
  return !!devices?.length && devices.every((d) => d.iommugroup === -1)
}

/**
 * Picked devices that share their IOMMU group with a device that is not
 * picked (and is not one of their own functions): passthrough takes the
 * whole group, so the official UI warns about this.
 */
export function sharedIommuGroups(paths: readonly string[], devices: readonly HostPciDevice[] | undefined): string[] {
  const list = devices ?? []
  const out: string[] = []
  for (const path of paths) {
    const dev = list.find((d) => d.id === path) ?? list.find((d) => d.id === `${path}.0`)
    if (!dev || dev.iommugroup === -1) continue
    const others = list.filter(
      (d) => d.iommugroup === dev.iommugroup && d.id !== path && !d.id.startsWith(`${path}.`) && !paths.includes(d.id) && !paths.includes(slotOf(d.id)),
    )
    if (others.length) out.push(path)
  }
  return out
}

// --------------------------------------------------------------- checks

export type EntryState = 'ok' | 'error' | 'loading' | 'unknown'

export interface EntryStatus {
  state: EntryState
  messages: string[]
}

const mismatch = (key: string, configured: string | undefined, actual: string | undefined) =>
  `${key} 不匹配（配置 ${configured ?? '无'}，实际 ${actual ?? '无'}）`

/**
 * Does a PCI entry still match the host? Compares vendor/device id,
 * subsystem id, IOMMU group (first device only) and mediated-device support
 * with GET /nodes/{node}/hardware/pci, like the official tree.
 */
export function checkPciItem(item: MapItem, devices: readonly HostPciDevice[], mdev: boolean): EntryStatus {
  const messages: string[] = []
  const paths = (item.path ?? '').split(';').filter(Boolean)
  if (paths.length === 0) return { state: 'error', messages: ['缺少设备路径'] }
  paths.forEach((path, idx) => {
    const id = /\.[0-9a-f]$/i.test(path) ? path : `${path}.0`
    const dev = devices.find((d) => d.id === id)
    if (!dev) {
      messages.push(`找不到 PCI 设备 ${id}`)
      return
    }
    const expected: Record<string, string | undefined> = {
      id: pciDeviceId(dev),
      'subsystem-id': pciSubsystemId(dev),
      mdev: dev.mdev ? '1' : '0',
    }
    if (idx === 0) expected.iommugroup = dev.iommugroup !== -1 ? String(dev.iommugroup) : undefined
    const configured: Record<string, string | undefined> = {
      id: hex(item.id),
      'subsystem-id': hex(item['subsystem-id']),
      mdev: mdev ? '1' : '0',
      iommugroup: item.iommugroup,
    }
    for (const key of Object.keys(expected)) {
      if ((configured[key] ?? '') !== (expected[key] ?? '')) messages.push(mismatch(key, configured[key], expected[key]))
    }
  })
  return { state: messages.length ? 'error' : 'ok', messages }
}

export const usbPortPath = (d: Pick<HostUsbDevice, 'busnum' | 'usbpath'>) => (d.usbpath ? `${d.busnum}-${d.usbpath}` : undefined)
export const usbDeviceId = (d: Pick<HostUsbDevice, 'vendid' | 'prodid'>) => `${hex(d.vendid)}:${hex(d.prodid)}`

/**
 * USB entry: a port entry needs a device with the configured id on that
 * port, an id entry any device with that id (what the node checks when the
 * guest starts; the official tree falls back to the id for port entries).
 */
export function checkUsbItem(item: MapItem, devices: readonly HostUsbDevice[]): EntryStatus {
  const dev = item.path ? devices.find((d) => usbPortPath(d) === item.path) : devices.find((d) => usbDeviceId(d) === hex(item.id))
  if (!dev) return { state: 'error', messages: [item.path ? `端口 ${item.path} 上没有设备` : `找不到 USB 设备 ${item.id ?? ''}`] }
  const actual = usbDeviceId(dev)
  if (hex(item.id) !== actual) return { state: 'error', messages: [mismatch('id', item.id, actual)] }
  return { state: 'ok', messages: [] }
}

/** Directory mappings: the node itself checks the path (GET …/dir?check-node=<node>). */
export function checkDirItem(checks: readonly MappingCheck[] | undefined): EntryStatus {
  const errors = (checks ?? []).filter((c) => c.severity === 'error' || c.severity === 'warning')
  return { state: errors.length ? 'error' : 'ok', messages: errors.map((c) => c.message.replace(/^Invalid configuration: /, '').trim()) }
}

// ------------------------------------------------------------ USB entries

export type UsbMode = 'id' | 'path'

/** Map entry for a USB device: by vendor:product id, or by port (the id then records the device found there). */
export function usbMapEntry(
  node: string,
  mode: UsbMode,
  value: string,
  devices: readonly HostUsbDevice[],
  previous?: MapItem,
): { entry: string } | { error: string } {
  const v = value.trim().toLowerCase()
  const keep = previous?.description ? { description: previous.description } : {}
  if (mode === 'id') {
    if (!USB_ID_RE.test(v)) return { error: '格式：厂商ID:产品ID，例如 046d:c52b' }
    return { entry: stringifyPropertyString({ node, id: v, ...keep }) }
  }
  if (!USB_PORT_RE.test(v)) return { error: '格式：总线-端口，例如 1-2.3' }
  const dev = devices.find((d) => usbPortPath(d) === v)
  const id = dev ? usbDeviceId(dev) : previous?.path === v ? previous.id : undefined
  if (!id) return { error: '这个端口上现在没有设备，无法确定设备 ID' }
  return { entry: stringifyPropertyString({ node, path: v, id, ...keep }) }
}

export const USB_ID_RE = /^[0-9a-f]{4}:[0-9a-f]{4}$/i
export const USB_PORT_RE = /^\d+-\d+(\.\d+)*$/

// ------------------------------------------------------------ dir entries

/** Absolute path without the characters a property string cannot hold. */
export function validateDirPath(path: string): string | undefined {
  const v = path.trim()
  if (!v) return '必填'
  if (!v.startsWith('/')) return '需要绝对路径（以 / 开头）'
  if (/[;,=()]/.test(v)) return '路径里不能有 ; , = ( )'
  return undefined
}

export function dirMapEntry(node: string, path: string): string {
  return stringifyPropertyString({ node, path: path.trim() })
}

// ------------------------------------------------------- mapping params

/** pve-configid: a letter, then letters, digits, - or _ (at least 2 characters). */
export function validateMappingId(id: string): string | undefined {
  const v = id.trim()
  if (!v) return '必填'
  if (!/^[a-z][a-z0-9_-]+$/i.test(v)) return '以字母开头，只能包含字母、数字、- 和 _，至少 2 个字符'
  return undefined
}

export interface MappingFlags {
  mdev: boolean
  liveMigration: boolean
}

/** POST /cluster/mapping/{kind}: id, the first node's entries, description and (PCI) flags. */
export function createMappingParams(id: string, entries: readonly string[], description: string, flags?: MappingFlags): Params {
  const params: Params = { id: id.trim(), map: [...entries] }
  if (description.trim()) params.description = description.trim()
  if (flags?.mdev) params.mdev = 1
  if (flags?.liveMigration) params['live-migration-capable'] = 1
  return params
}

/** PUT of the mapping-wide fields (description, PCI flags) plus the unchanged map; null when nothing changed. */
export function globalMappingParams(mapping: ClusterMapping, description: string, flags?: MappingFlags): Params | null {
  const after: Record<string, string | number | undefined> = { description: description.trim() || undefined }
  if (flags) {
    after.mdev = flags.mdev ? 1 : undefined
    after['live-migration-capable'] = flags.liveMigration ? 1 : undefined
  }
  const before = {
    description: mapping.description,
    mdev: mapping.mdev === true || mapping.mdev === 1 ? 1 : undefined,
    'live-migration-capable': mapping['live-migration-capable'] ? 1 : undefined,
  }
  // PVE requires `map` on every update: resend the current entries.
  return configUpdateParams(before, after, { digest: mapping.digest, extra: { map: [...(mapping.map ?? [])] } })
}

/** PUT of one node's entries (other nodes unchanged); null when nothing changed. */
export function nodeMappingParams(mapping: ClusterMapping, node: string, entries: readonly string[]): Params | null {
  const map = replaceNodeEntries(mapping.map, node, entries)
  const same = map.length === (mapping.map ?? []).length && map.every((m) => mapping.map?.includes(m))
  if (same) return null
  const params: Params = { map }
  if (mapping.digest) params.digest = mapping.digest
  return params
}

// ------------------------------------------------------------ CPU models

export type FlagState = '+' | '-'

/** "+aes;-pcid" → { aes: '+', pcid: '-' } */
export function parseFlags(flags: string | undefined): Record<string, FlagState> {
  const out: Record<string, FlagState> = {}
  for (const f of parseListValue(flags)) {
    const sign = f[0]
    if ((sign === '+' || sign === '-') && f.length > 1) out[f.slice(1)] = sign
  }
  return out
}

export function stringifyFlags(flags: Record<string, FlagState | undefined>): string {
  return Object.entries(flags)
    .filter((e): e is [string, FlagState] => e[1] === '+' || e[1] === '-')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, sign]) => `${sign}${name}`)
    .join(';')
}

export const customCpuName = (cputype: string) => cputype.replace(/^custom-/, '')

export interface CpuModelForm {
  name: string
  reportedModel: string
  hvVendorId: string
  hidden: boolean
  /** '' = default, 'host', or a number 8–64. */
  physBits: string
  guestPhysBits: number | undefined
  level: number | undefined
  flags: Record<string, FlagState | undefined>
}

export function cpuModelForm(model?: CustomCpuModel): CpuModelForm {
  return {
    name: model ? customCpuName(model.cputype) : '',
    reportedModel: model?.['reported-model'] ?? '',
    hvVendorId: model?.['hv-vendor-id'] ?? '',
    hidden: model?.hidden === true || model?.hidden === 1,
    physBits: model?.['phys-bits'] !== undefined ? String(model['phys-bits']) : '',
    guestPhysBits: model?.['guest-phys-bits'],
    level: model?.level,
    flags: parseFlags(model?.flags),
  }
}

export interface CpuFormErrors {
  name?: string
  reportedModel?: string
  hvVendorId?: string
  physBits?: string
}

export function validateCpuModelForm(f: CpuModelForm, isCreate: boolean): CpuFormErrors {
  const e: CpuFormErrors = {}
  if (isCreate) {
    const n = f.name.trim().replace(/^custom-/, '')
    if (!n) e.name = '必填'
    else if (!/^[a-z][a-z0-9_-]+$/i.test(n)) e.name = '以字母开头，只能包含字母、数字、- 和 _'
    else if (n.length > 40) e.name = '最多 40 个字符'
    if (!f.reportedModel) e.reportedModel = '必填'
  }
  if (f.hvVendorId && !/^[a-z0-9]{1,12}$/i.test(f.hvVendorId)) e.hvVendorId = '1–12 个字母或数字'
  if (f.physBits && f.physBits !== 'host') {
    const n = Number(f.physBits)
    if (!Number.isInteger(n) || n < 8 || n > 64) e.physBits = '8–64 之间的整数，或 host'
  }
  return e
}

function cpuValues(f: CpuModelForm): Record<string, string | number | undefined> {
  return {
    'reported-model': f.reportedModel || undefined,
    'hv-vendor-id': f.hvVendorId.trim() || undefined,
    hidden: f.hidden ? 1 : undefined,
    'phys-bits': f.physBits || undefined,
    'guest-phys-bits': f.guestPhysBits,
    level: f.level,
    flags: stringifyFlags(f.flags) || undefined,
  }
}

/** POST /cluster/qemu/custom-cpu-models (unset fields are left out). */
export function createCpuModelParams(f: CpuModelForm): Params {
  const params: Params = { cputype: f.name.trim().replace(/^custom-/, '') }
  for (const [k, v] of Object.entries(cpuValues(f))) if (v !== undefined) params[k] = v
  return params
}

/** PUT /cluster/qemu/custom-cpu-models/{cputype}: changed fields, cleared ones in `delete`; null when unchanged. */
export function updateCpuModelParams(model: CustomCpuModel, f: CpuModelForm): Params | null {
  const after = cpuValues(f)
  // reported-model cannot be deleted; keep the stored one when the field is empty.
  if (!after['reported-model']) delete after['reported-model']
  const before: Record<string, string | number | undefined> = {
    'reported-model': model['reported-model'],
    'hv-vendor-id': model['hv-vendor-id'],
    hidden: model.hidden === true || model.hidden === 1 ? 1 : undefined,
    'phys-bits': model['phys-bits'],
    'guest-phys-bits': model['guest-phys-bits'],
    level: model.level,
    flags: model.flags ? stringifyFlags(parseFlags(model.flags)) : undefined,
  }
  return configUpdateParams(before, after, { digest: model.digest })
}
