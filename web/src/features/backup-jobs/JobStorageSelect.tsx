import { useEffect, useMemo } from 'react'

import { useClusterResources } from '@/api/queries'
import { isStorage, type StorageResource } from '@/api/types'
import { SelectField, type SelectOption } from '@/components/form'
import { formatBytes } from '@/lib/format'

export interface ClusterStorage {
  storage: string
  /** Plugin type (dir, nfs, pbs, lvmthin, …). */
  type: string
  shared: boolean
  /** Nodes that report the storage as available. */
  nodes: string[]
  avail?: number | undefined
}

/**
 * Storages with `content` across the cluster (one entry per storage id), or
 * on one node: the job's storage can be any storage the job's nodes can reach.
 */
export function useClusterStorages(content: string, node: string) {
  const query = useClusterResources({
    select: (all) => all.filter(isStorage),
  })
  const storages = useMemo(() => {
    const byId = new Map<string, ClusterStorage>()
    for (const s of (query.data ?? []) as StorageResource[]) {
      if (!(s.content ?? '').split(',').includes(content)) continue
      if (node && s.node !== node) continue
      const entry = byId.get(s.storage) ?? {
        storage: s.storage,
        type: s.plugintype ?? '',
        shared: s.shared === 1,
        nodes: [],
      }
      if (s.status === 'available') {
        entry.nodes.push(s.node)
        if (s.maxdisk) entry.avail = Math.max(entry.avail ?? 0, s.maxdisk - (s.disk ?? 0))
      }
      byId.set(s.storage, entry)
    }
    return [...byId.values()].sort((a, b) => a.storage.localeCompare(b.storage))
  }, [query.data, content, node])
  return { storages, isPending: query.isPending }
}

export function JobStorageSelect({
  content,
  node,
  value,
  onValueChange,
  autoSelect = false,
  emptyOption,
  disabled,
}: {
  content: 'backup' | 'images'
  node: string
  value: string
  onValueChange: (value: string) => void
  autoSelect?: boolean
  emptyOption?: string
  disabled?: boolean
}) {
  const { storages, isPending } = useClusterStorages(content, node)
  const options: SelectOption[] = storages.map((s) => ({
    value: s.storage,
    label: s.storage,
    description: [s.type === 'pbs' ? 'Proxmox Backup Server' : s.type, s.shared ? '共享' : null, s.avail !== undefined ? `可用 ${formatBytes(s.avail)}` : null]
      .filter(Boolean)
      .join(' · '),
    disabled: s.nodes.length === 0,
  }))
  // A configured storage stays visible even when it no longer matches.
  if (value && !options.some((o) => o.value === value)) options.unshift({ value, label: value, description: node ? `不在节点 ${node} 上` : '不可用' })
  const first = storages.find((s) => s.nodes.length > 0)?.storage
  useEffect(() => {
    if (autoSelect && !value && first) onValueChange(first)
  }, [autoSelect, value, first, onValueChange])
  return (
    <SelectField
      value={value || undefined}
      onValueChange={(v) => onValueChange(v ?? '')}
      options={options}
      emptyOption={emptyOption}
      loading={isPending}
      placeholder={options.length === 0 && !isPending ? '没有可用的存储' : '选择存储'}
      disabled={disabled}
    />
  )
}
