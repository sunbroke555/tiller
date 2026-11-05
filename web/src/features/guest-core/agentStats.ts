// Pure helpers for the guest agent statistics (get-load, get-cpustats,
// get-disks, get-diskstats). The CPU and disk counters are cumulative, so
// rates come from the difference between two samples. Every field may be
// missing; counter resets (guest reboot, CPU/disk hot-unplug) never produce
// negative rates — the affected CPU or disk is left out instead.

import type { AgentCpuStat, AgentDisk, AgentDiskStat, AgentLoad, AgentSample } from '@/api/guest-core'

/** Samples further apart than this are not compared (e.g. a cached sample from minutes ago). */
export const MAX_SAMPLE_GAP_MS = 120_000

/** Bytes per sector in /proc/diskstats, independent of the device's sector size. */
const SECTOR = 512

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Seconds between two samples, or null when they cannot be compared. */
export function sampleGap<T>(prev: AgentSample<T> | undefined, cur: AgentSample<T> | undefined): number | null {
  if (!prev || !cur) return null
  const ms = cur.at - prev.at
  if (!(ms > 0) || ms > MAX_SAMPLE_GAP_MS) return null
  return ms / 1000
}

// -------------------------------------------------------------------- load

export interface LoadAverages {
  load1?: number
  load5?: number
  load15?: number
}

/** get-load result with only finite numbers; null when nothing is usable. */
export function parseLoad(load: AgentLoad | null | undefined): LoadAverages | null {
  if (!load || typeof load !== 'object') return null
  const out: LoadAverages = { load1: num(load.load1m), load5: num(load.load5m), load15: num(load.load15m) }
  return out.load1 === undefined && out.load5 === undefined && out.load15 === undefined ? null : out
}

// --------------------------------------------------------------------- cpu

/** Share of all CPU time between two samples, each 0..1. */
export interface CpuBreakdown {
  /** user + nice (includes guest time, as /proc/stat does). */
  user: number
  /** system + irq + softirq. */
  system: number
  iowait: number
  steal: number
  idle: number
  /** Everything except idle and iowait. */
  busy: number
  /** CPUs that took part in the comparison. */
  cpus: number
}

// guest/guestnice are already counted in user/nice, so they are not part of the total.
const CPU_FIELDS = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal'] as const
type CpuField = (typeof CPU_FIELDS)[number]

function cpuIndex(stat: AgentCpuStat, i: number): number {
  return num(stat.cpu) ?? i
}

/**
 * CPU time shares from two get-cpustats samples. CPUs are matched by their
 * index; a CPU whose counters went backwards (reboot) or that is missing in
 * one sample is skipped. Returns null when no time has passed.
 */
export function cpuBreakdown(prev: AgentCpuStat[] | null | undefined, cur: AgentCpuStat[] | null | undefined): CpuBreakdown | null {
  if (!Array.isArray(prev) || !Array.isArray(cur)) return null
  const before = new Map<number, AgentCpuStat>()
  prev.forEach((s, i) => {
    if (s && typeof s === 'object') before.set(cpuIndex(s, i), s)
  })
  const sum: Record<CpuField, number> = { user: 0, nice: 0, system: 0, idle: 0, iowait: 0, irq: 0, softirq: 0, steal: 0 }
  let cpus = 0
  cur.forEach((s, i) => {
    if (!s || typeof s !== 'object') return
    const p = before.get(cpuIndex(s, i))
    if (!p) return
    const d: Partial<Record<CpuField, number>> = {}
    for (const f of CPU_FIELDS) {
      const a = num(p[f])
      const b = num(s[f])
      if (a === undefined || b === undefined) continue
      if (b < a) return // counter reset: ignore this CPU
      d[f] = b - a
    }
    if (Object.keys(d).length === 0) return
    for (const f of CPU_FIELDS) sum[f] += d[f] ?? 0
    cpus++
  })
  const total = CPU_FIELDS.reduce((t, f) => t + sum[f], 0)
  if (cpus === 0 || total <= 0) return null
  const share = (v: number) => v / total
  const idle = share(sum.idle)
  const iowait = share(sum.iowait)
  return {
    user: share(sum.user + sum.nice),
    system: share(sum.system + sum.irq + sum.softirq),
    iowait,
    steal: share(sum.steal),
    idle,
    busy: Math.max(0, 1 - idle - iowait),
    cpus,
  }
}

// ------------------------------------------------------------------- disks

export interface DiskRate {
  name: string
  /** Bytes per second; null when the counter is missing. */
  readBps: number | null
  writeBps: number | null
  /** Completed operations per second. */
  readIops: number | null
  writeIops: number | null
}

function stat(d: AgentDiskStat, key: string): number | undefined {
  return num(d.stats?.[key])
}

function rate(prev: number | undefined, cur: number | undefined, seconds: number, scale = 1): number | null | 'reset' {
  if (prev === undefined || cur === undefined) return null
  if (cur < prev) return 'reset'
  return ((cur - prev) * scale) / seconds
}

/** Virtual block devices that only add noise to the list. */
const VIRTUAL_DISK = /^(loop|ram|zram|fd|sr)\d+$/

/** "sda1", "vdb2", "nvme0n1p1", "mmcblk0p1" → the parent disk name, otherwise null. */
export function partitionParent(name: string): string | null {
  const m = /^((?:nvme\d+n\d+|mmcblk\d+|md\d+|nbd\d+))p\d+$/.exec(name) ?? /^((?:[shv]d|xvd)[a-z]+)\d+$/.exec(name)
  return m?.[1] ?? null
}

/** Drops loop/ram devices, devices that never did any IO, and partitions of listed disks. */
export function visibleDiskStats(list: AgentDiskStat[] | null | undefined): AgentDiskStat[] {
  if (!Array.isArray(list)) return []
  const valid = list.filter((d) => d && typeof d.name === 'string' && d.name && !VIRTUAL_DISK.test(d.name))
  const used = valid.filter((d) => {
    const ios = (stat(d, 'read-ios') ?? 0) + (stat(d, 'write-ios') ?? 0)
    // Without IO counters there is nothing to tell; keep the disk.
    return stat(d, 'read-ios') === undefined && stat(d, 'write-ios') === undefined ? true : ios > 0
  })
  const names = new Set(used.map((d) => d.name))
  return used.filter((d) => {
    const parent = partitionParent(d.name)
    return !parent || !names.has(parent)
  })
}

/**
 * Per-disk throughput and IOPS between two get-diskstats samples, in the
 * order of the current sample. A disk that is new or whose counters went
 * backwards is skipped.
 */
export function diskRates(prev: AgentDiskStat[] | null | undefined, cur: AgentDiskStat[] | null | undefined, seconds: number): DiskRate[] {
  if (!Array.isArray(prev) || !Array.isArray(cur) || !(seconds > 0)) return []
  const before = new Map(prev.filter((d) => d && typeof d.name === 'string').map((d) => [d.name, d]))
  const out: DiskRate[] = []
  for (const d of visibleDiskStats(cur)) {
    const p = before.get(d.name)
    if (!p) continue
    const readBps = rate(stat(p, 'read-sectors'), stat(d, 'read-sectors'), seconds, SECTOR)
    const writeBps = rate(stat(p, 'write-sectors'), stat(d, 'write-sectors'), seconds, SECTOR)
    const readIops = rate(stat(p, 'read-ios'), stat(d, 'read-ios'), seconds)
    const writeIops = rate(stat(p, 'write-ios'), stat(d, 'write-ios'), seconds)
    if (readBps === 'reset' || writeBps === 'reset' || readIops === 'reset' || writeIops === 'reset') continue
    if (readBps === null && writeBps === null && readIops === null && writeIops === null) continue
    out.push({ name: d.name, readBps, writeBps, readIops, writeIops })
  }
  return out
}

/** Disk names without the "/dev/" prefix. */
export function shortDevName(name: string): string {
  return name.replace(/^\/dev\//, '')
}

export interface GuestDiskRow {
  name: string
  partition: boolean
  /** Nesting depth for display: partitions under their disk. */
  depth: number
  alias?: string
  serial?: string
  bus?: string
  /** NVMe SMART temperature in °C, when reported. */
  temperature?: number
}

function diskRow(d: AgentDisk, depth: number): GuestDiskRow {
  const addr = d.address && typeof d.address === 'object' ? d.address : undefined
  const serial = typeof addr?.serial === 'string' && addr.serial.trim() ? addr.serial.trim() : undefined
  const bus = typeof addr?.['bus-type'] === 'string' && addr['bus-type'] !== 'unknown' ? addr['bus-type'] : undefined
  const kelvin = num(d.smart?.temperature)
  return {
    name: shortDevName(d.name),
    partition: d.partition === true,
    depth,
    alias: typeof d.alias === 'string' && d.alias ? d.alias : undefined,
    serial,
    bus,
    temperature: kelvin !== undefined && kelvin > 0 ? Math.round(kelvin - 273.15) : undefined,
  }
}

/**
 * get-disks as a flat display list: disks first, each followed by the
 * partitions that depend on it. Partitions whose parent is not listed and
 * other devices (LVM, RAID) keep their own place.
 */
export function guestDiskRows(list: AgentDisk[] | null | undefined): GuestDiskRow[] {
  if (!Array.isArray(list)) return []
  const valid = list.filter((d) => d && typeof d.name === 'string' && d.name)
  const names = new Set(valid.map((d) => d.name))
  const parentOf = (d: AgentDisk) =>
    d.partition === true ? (d.dependencies ?? []).find((n) => typeof n === 'string' && names.has(n) && n !== d.name) : undefined
  const children = new Map<string, AgentDisk[]>()
  for (const d of valid) {
    const parent = parentOf(d)
    if (parent) children.set(parent, [...(children.get(parent) ?? []), d])
  }
  const rows: GuestDiskRow[] = []
  const seen = new Set<string>()
  const add = (d: AgentDisk, depth: number) => {
    if (seen.has(d.name)) return
    seen.add(d.name)
    rows.push(diskRow(d, depth))
    for (const c of children.get(d.name) ?? []) add(c, Math.min(depth + 1, 2))
  }
  for (const d of valid) if (!parentOf(d)) add(d, 0)
  // Dependency cycles leave entries unreached; list them at the top level.
  for (const d of valid) add(d, 0)
  return rows
}
