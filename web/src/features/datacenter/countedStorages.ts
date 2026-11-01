// Which storages count toward the datacenter storage total (official
// My Settings → "Dashboard Storages", state key dash-storages). Stored per
// device in localStorage as /cluster/resources ids ("storage/<node>/<id>");
// an empty list counts every storage.

import { useSyncExternalStore } from 'react'
import { instanceStorageKey } from '@/api/instance-scope'

import { isStorage, type ClusterResource, type StorageResource } from '@/api/types'

export const COUNTED_STORAGES_KEY = instanceStorageKey('tiller:dashboard-storages')
const EVENT = 'tiller:dashboard-storages'

function parse(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []
  } catch {
    return []
  }
}

let cacheRaw: string | null | undefined
let cacheValue: string[] = []

export function readCountedStorages(): string[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(COUNTED_STORAGES_KEY)
  } catch {
    raw = null
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw
    cacheValue = parse(raw)
  }
  return cacheValue
}

export function writeCountedStorages(ids: readonly string[]) {
  try {
    if (ids.length === 0) localStorage.removeItem(COUNTED_STORAGES_KEY)
    else localStorage.setItem(COUNTED_STORAGES_KEY, JSON.stringify([...new Set(ids)].sort()))
  } catch {
    // private mode / quota: the setting is optional
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === COUNTED_STORAGES_KEY) cb()
  }
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', onStorage)
  }
}

/** The counted storage ids (empty = all) and a setter, shared by every view. */
export function useCountedStorages(): [string[], (ids: readonly string[]) => void] {
  const ids = useSyncExternalStore(subscribe, readCountedStorages, () => [])
  return [ids, writeCountedStorages]
}

/** One row of the "which storages count" list: shared storages appear once. */
export interface StorageChoice {
  key: string
  storage: string
  /** null for a shared storage (one row for all nodes). */
  node: string | null
  plugintype?: string | undefined
  /** Resource ids behind the row (one per node for shared storages). */
  ids: string[]
  used: number
  total: number
  available: boolean
}

export function storageChoices(resources: readonly ClusterResource[]): StorageChoice[] {
  const by = new Map<string, StorageChoice>()
  for (const r of resources) {
    if (!isStorage(r)) continue
    const shared = r.shared === 1
    const key = shared ? `shared:${r.storage}` : r.id
    const c = by.get(key)
    if (c) {
      c.ids.push(r.id)
      if (!c.available && r.status === 'available') Object.assign(c, sizes(r), { available: true })
      continue
    }
    by.set(key, { key, storage: r.storage, node: shared ? null : r.node, plugintype: r.plugintype, ids: [r.id], ...sizes(r), available: r.status === 'available' })
  }
  return [...by.values()].sort((a, b) => a.storage.localeCompare(b.storage) || (a.node ?? '').localeCompare(b.node ?? ''))
}

function sizes(r: StorageResource) {
  return { used: r.disk ?? 0, total: r.maxdisk ?? 0 }
}

/**
 * Toggle a choice. The stored list stays empty while every storage counts
 * (so new storages count too), and never becomes empty by unchecking the
 * last storage (empty means "all").
 */
export function toggleChoice(counted: readonly string[], choices: readonly StorageChoice[], choice: StorageChoice, on: boolean): string[] {
  const base = counted.length ? counted : choices.flatMap((c) => c.ids)
  const rest = base.filter((id) => !choice.ids.includes(id))
  const next = on ? [...rest, ...choice.ids] : rest
  if (next.length === 0) return [...counted]
  return choices.every((c) => isCounted(next, c)) ? [] : next
}

export function isCounted(counted: readonly string[], choice: StorageChoice): boolean {
  return counted.length === 0 || choice.ids.some((id) => counted.includes(id))
}
