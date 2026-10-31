// PVE property strings and config updates.
//
// Many PVE config values are "property strings": comma separated key=value
// pairs, optionally with one bare value for the schema's default key:
//
//   net0:   virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,firewall=1
//   scsi0:  local-lvm:vm-100-disk-0,iothread=1,size=32G      (default key "file")
//   rootfs: local-lvm:vm-200-disk-0,size=8G                   (default key "volume")
//   cpu:    host,flags=+aes;-pcid                             (default key "cputype", list values use ";")
//
// parsePropertyString / stringifyPropertyString round-trip these, keeping the
// key order so an edit changes as little of the string as possible.
//
// Config updates (PUT/POST /nodes/{node}/{qemu|lxc}/{vmid}/config and friends)
// send changed keys as parameters, removed keys in `delete` (comma separated)
// and the `digest` of the config that was edited so PVE rejects the write when
// someone else changed it meanwhile. configUpdateParams builds exactly that.

import type { Params } from '@/api/client'

/** Parsed property string. Values stay strings; use the helpers below to convert. */
export type PropertyMap = Record<string, string>

/** A value accepted by stringifyPropertyString; empty values are dropped. */
export type PropertyValue = string | number | boolean | null | undefined | readonly (string | number)[]

export class PropertyStringError extends Error {
  override readonly name = 'PropertyStringError'
}

/**
 * Parse "a=1,b=2" into { a: '1', b: '2' }. A part without "=" is the value of
 * `defaultKey` (an error when there is none, or when it appears twice).
 * Values may contain "=" (only the first one separates key and value).
 */
export function parsePropertyString(value: string | null | undefined, defaultKey?: string): PropertyMap {
  const out: PropertyMap = {}
  if (!value) return out
  for (const raw of value.split(',')) {
    const part = raw.trim()
    if (!part) continue
    const eq = part.indexOf('=')
    if (eq === -1) {
      if (!defaultKey) throw new PropertyStringError(`属性字符串中的 "${part}" 缺少键名`)
      if (defaultKey in out) throw new PropertyStringError(`属性字符串中 ${defaultKey} 重复`)
      out[defaultKey] = part
      continue
    }
    const key = part.slice(0, eq).trim()
    if (!key) throw new PropertyStringError(`属性字符串中的 "${part}" 缺少键名`)
    out[key] = part.slice(eq + 1)
  }
  return out
}

/** Like parsePropertyString but never throws (malformed input gives {}). */
export function tryParsePropertyString(value: string | null | undefined, defaultKey?: string): PropertyMap {
  try {
    return parsePropertyString(value, defaultKey)
  } catch {
    return {}
  }
}

function encodeValue(value: PropertyValue): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (Array.isArray(value)) {
    const items = (value as readonly (string | number)[]).map(String).filter((v) => v !== '')
    return items.length ? items.join(';') : null
  }
  const s = String(value)
  return s === '' ? null : s
}

export interface StringifyOptions {
  /** Written first, without "key=". */
  defaultKey?: string
  /** Sort the remaining keys (the official UI does); default keeps insertion order. */
  sort?: boolean
}

/**
 * { file: 'local:iso/x.iso', media: 'cdrom' } → "local:iso/x.iso,media=cdrom".
 * null/undefined/'' and empty arrays are dropped, booleans become 1/0,
 * arrays are joined with ";".
 */
export function stringifyPropertyString(
  props: Record<string, PropertyValue>,
  defaultKeyOrOptions?: string | StringifyOptions,
): string {
  const opts: StringifyOptions =
    typeof defaultKeyOrOptions === 'string' ? { defaultKey: defaultKeyOrOptions } : (defaultKeyOrOptions ?? {})
  const parts: string[] = []
  let head: string | null = null
  for (const [key, raw] of Object.entries(props)) {
    const value = encodeValue(raw)
    if (value === null) continue
    if (/[,]/.test(value)) throw new PropertyStringError(`${key} 的值不能包含逗号`)
    if (key === opts.defaultKey) head = value
    else parts.push(`${key}=${value}`)
  }
  if (opts.sort) parts.sort()
  if (head !== null) parts.unshift(head)
  return parts.join(',')
}

/**
 * Change some keys of a property string and keep the rest (and their order):
 * updatePropertyString('virtio=AA:..,bridge=vmbr0', { bridge: 'vmbr1', tag: 5 })
 * → 'virtio=AA:..,bridge=vmbr1,tag=5'. null/undefined/'' removes a key.
 */
export function updatePropertyString(
  value: string | null | undefined,
  patch: Record<string, PropertyValue>,
  defaultKey?: string,
): string {
  const merged: Record<string, PropertyValue> = { ...parsePropertyString(value, defaultKey) }
  for (const [k, v] of Object.entries(patch)) merged[k] = v
  return stringifyPropertyString(merged, defaultKey)
}

/** Split a ";"-list value ("+aes;-pcid", trunks "10;20") into items. */
export function parseListValue(value: string | null | undefined): string[] {
  return value ? value.split(';').map((s) => s.trim()).filter(Boolean) : []
}

/** "1"/"0" (or "on"/"yes") → boolean; missing → fallback. */
export function propBool(value: string | null | undefined, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return value === '1' || value === 'on' || value === 'yes' || value === 'true'
}

/** Numeric property, or fallback when missing/invalid. */
export function propNumber(value: string | number | null | undefined, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// ------------------------------------------------------------- volumes

export interface VolumeId {
  storage: string
  /** Volume name inside the storage, e.g. "vm-100-disk-0" or "iso/debian.iso". */
  volume: string
}

/** "local-lvm:vm-100-disk-0" → { storage, volume }; null for paths ("/dev/sdb") or "none". */
export function parseVolumeId(volid: string | null | undefined): VolumeId | null {
  if (!volid || volid.startsWith('/')) return null
  const i = volid.indexOf(':')
  if (i <= 0) return null
  return { storage: volid.slice(0, i), volume: volid.slice(i + 1) }
}

/**
 * QEMU disk / CD-ROM / EFI / TPM drive string (default key "file").
 * "local-lvm:vm-100-disk-0,iothread=1,size=32G" → { file, iothread, size }.
 * New disks are written as "<storage>:<size in GiB>", e.g. "local-lvm:32".
 */
export function parseDrive(value: string | null | undefined): PropertyMap & { file?: string } {
  return parsePropertyString(value, 'file')
}

export function isCdrom(drive: PropertyMap): boolean {
  return drive.media === 'cdrom'
}

/** LXC rootfs / mount point (default key "volume"). */
export function parseMountPoint(value: string | null | undefined): PropertyMap & { volume?: string } {
  return parsePropertyString(value, 'volume')
}

// ------------------------------------------------------- QEMU network

/** NIC models QEMU accepts as the leading key of net[n]. */
export const QEMU_NIC_MODELS = [
  'virtio',
  'e1000',
  'e1000e',
  'rtl8139',
  'vmxnet3',
  'e1000-82540em',
  'e1000-82544gc',
  'e1000-82545em',
  'i82551',
  'i82557b',
  'i82559er',
  'ne2k_isa',
  'ne2k_pci',
  'pcnet',
] as const

export interface QemuNet {
  model: string
  /** MAC address; empty for a new NIC (PVE generates one). */
  macaddr: string
  /** Everything else: bridge, tag, firewall, rate, queues, mtu, link_down, trunks… */
  options: PropertyMap
}

/**
 * QEMU net[n] has a quirk: the model is the key and the MAC its value
 * ("virtio=BC:24:11:AA:BB:CC,bridge=vmbr0"), or the model alone for a random
 * MAC ("virtio,bridge=vmbr0"). The canonical "model=virtio,macaddr=…" is
 * accepted too.
 */
export function parseQemuNet(value: string | null | undefined): QemuNet | null {
  if (!value) return null
  const options: PropertyMap = {}
  let model = ''
  let macaddr = ''
  for (const raw of value.split(',')) {
    const part = raw.trim()
    if (!part) continue
    const eq = part.indexOf('=')
    const key = eq === -1 ? part : part.slice(0, eq)
    const val = eq === -1 ? '' : part.slice(eq + 1)
    if (!model && (QEMU_NIC_MODELS as readonly string[]).includes(key)) {
      model = key
      macaddr = val
    } else if (key === 'model') {
      model = val
    } else if (key === 'macaddr') {
      macaddr = val
    } else if (eq !== -1) {
      options[key] = val
    }
  }
  return model ? { model, macaddr, options } : null
}

/** Inverse of parseQemuNet, in the short form the official UI writes. */
export function stringifyQemuNet(net: QemuNet): string {
  const head = net.macaddr ? `${net.model}=${net.macaddr}` : net.model
  const rest = stringifyPropertyString(net.options)
  return rest ? `${head},${rest}` : head
}

// ------------------------------------------------------- config updates

/** A config as returned by GET .../config (values are strings or numbers). */
export type ConfigValues = Record<string, string | number | boolean | null | undefined>

function normalize(v: string | number | boolean | null | undefined): string | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? '1' : '0'
  const s = String(v)
  return s === '' ? null : s
}

export interface ConfigChanges {
  /** Keys whose value is new or changed. */
  set: Record<string, string>
  /** Keys present before that are now empty/null/undefined. */
  delete: string[]
}

/**
 * Compare the edited fields with the loaded config. Only keys present in
 * `after` (plus `opts.keys`) are considered, so a form passes just the fields
 * it manages and never deletes unrelated settings. Values compare as strings
 * (booleans as 1/0), so 1 and "1" are equal.
 */
export function configChanges(
  before: ConfigValues | null | undefined,
  after: ConfigValues,
  opts: { keys?: readonly string[] } = {},
): ConfigChanges {
  const keys = new Set([...Object.keys(after), ...(opts.keys ?? [])])
  const set: Record<string, string> = {}
  const del: string[] = []
  for (const key of keys) {
    const old = normalize(before?.[key])
    const next = normalize(after[key])
    if (next === null) {
      if (old !== null) del.push(key)
    } else if (next !== old) {
      set[key] = next
    }
  }
  return { set, delete: del }
}

export interface ConfigUpdateOptions {
  /** `digest` of the loaded config; PVE refuses the write if it changed meanwhile. */
  digest?: string | null | undefined
  /** Extra keys to consider (see configChanges). */
  keys?: readonly string[]
  /** Extra parameters sent as-is (e.g. { background_delay: 5 } or { skiplock: 1 }). */
  extra?: Params
}

/**
 * Parameters for a config PUT/POST, or null when nothing changed:
 *
 *   const params = configUpdateParams(config, { memory: 4096, balloon: '' }, { digest: config.digest })
 *   // → { memory: '4096', delete: 'balloon', digest: '…' }
 */
export function configUpdateParams(
  before: ConfigValues | null | undefined,
  after: ConfigValues,
  opts: ConfigUpdateOptions = {},
): Params | null {
  const { set, delete: del } = configChanges(before, after, opts)
  if (Object.keys(set).length === 0 && del.length === 0) return null
  const params: Params = { ...set }
  if (del.length) params.delete = del.join(',')
  const digest = opts.digest ?? (typeof before?.digest === 'string' ? before.digest : undefined)
  if (digest) params.digest = digest
  return { ...params, ...opts.extra }
}
