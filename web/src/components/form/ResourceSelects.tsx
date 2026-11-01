import { useEffect, useMemo } from 'react'

import { useClusterResources, useClusterStatus, useNodeNetworks, useNodeStorages } from '@/api/queries'
import { isNode, type NodeStorage, type StorageContent } from '@/api/types'
import { StatusDot } from '@/components/StatusDot'
import { formatBytes, formatPercent, ratio } from '@/lib/format'

import { SelectField, type SelectOption } from './SelectField'

interface CommonProps {
  value: string | undefined | null
  onValueChange: (value: string | undefined) => void
  /** Pick the first (or best) option when the value is empty. Default true. */
  autoSelect?: boolean
  /** Adds a "not set" option, e.g. "无". */
  emptyOption?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

function useAutoSelect(
  enabled: boolean,
  value: string | undefined | null,
  candidate: string | undefined,
  onValueChange: (v: string | undefined) => void,
) {
  useEffect(() => {
    if (enabled && !value && candidate) onValueChange(candidate)
  }, [enabled, value, candidate, onValueChange])
}

// --------------------------------------------------------------- storage

export interface StorageSelectProps extends CommonProps {
  node: string | null | undefined
  /** Only storages that can hold this content (images, rootdir, iso, vztmpl, backup, …). */
  content?: StorageContent | readonly StorageContent[]
  /** Hide storages that are not active on the node. Default true. */
  activeOnly?: boolean
  /** Extra filter, e.g. only storages that support snapshots. */
  filter?: (storage: NodeStorage) => boolean
}

/** Storages of a node with free space, filtered by content type. */
export function StorageSelect({
  node,
  content,
  activeOnly = true,
  filter,
  value,
  onValueChange,
  autoSelect = true,
  emptyOption,
  placeholder = '选择存储',
  disabled,
  className,
}: StorageSelectProps) {
  const { data, isPending, isError } = useNodeStorages(node, content)
  const storages = useMemo(
    () =>
      (data ?? [])
        .filter((s) => (!activeOnly || s.active !== 0) && (!filter || filter(s)))
        .sort((a, b) => a.storage.localeCompare(b.storage)),
    [data, activeOnly, filter],
  )
  const options: SelectOption[] = storages.map((s) => ({
    value: s.storage,
    label: s.storage,
    description:
      s.avail !== undefined && s.total
        ? `${s.type} · 可用 ${formatBytes(s.avail)} / ${formatBytes(s.total)}`
        : s.type,
    disabled: s.active === 0,
  }))
  // The first one by name, like the official StorageSelector (autoSelect
  // picks the first record of its name-sorted store).
  const first = storages[0]?.storage
  useAutoSelect(autoSelect && !emptyOption, value, first, onValueChange)
  return (
    <SelectField
      value={value}
      onValueChange={onValueChange}
      options={options}
      emptyOption={emptyOption}
      loading={!!node && isPending}
      placeholder={!node ? '先选择节点' : isError ? '无法加载存储' : options.length === 0 && !isPending ? '没有可用的存储' : placeholder}
      disabled={disabled || !node}
      className={className}
    />
  )
}

// ---------------------------------------------------------------- bridge

export interface BridgeSelectProps extends CommonProps {
  node: string | null | undefined
}

/** Linux/OVS bridges and SDN VNets of a node, for guest NICs. */
export function BridgeSelect({
  node,
  value,
  onValueChange,
  autoSelect = true,
  emptyOption,
  placeholder = '选择网桥',
  disabled,
  className,
}: BridgeSelectProps) {
  const { data, isPending, isError } = useNodeNetworks(node, 'any_bridge')
  const options: SelectOption[] = (data ?? []).map((n) => ({
    value: n.iface,
    label: n.iface,
    description: [n.type === 'vnet' ? 'VNet' : n.bridge_vlan_aware ? 'VLAN aware' : null, n.cidr ?? n.comments?.trim()]
      .filter(Boolean)
      .join(' · '),
  }))
  // Keep a configured bridge visible even if the node no longer reports it.
  if (value && !options.some((o) => o.value === value)) options.unshift({ value, label: value, description: '不存在' })
  const preferred = data?.find((n) => n.iface === 'vmbr0')?.iface ?? data?.[0]?.iface
  useAutoSelect(autoSelect && !emptyOption, value, preferred, onValueChange)
  return (
    <SelectField
      value={value}
      onValueChange={onValueChange}
      options={options}
      emptyOption={emptyOption}
      loading={!!node && isPending}
      placeholder={!node ? '先选择节点' : isError ? '无法加载网络' : placeholder}
      disabled={disabled || !node}
      className={className}
    />
  )
}

// ------------------------------------------------------------------ node

export interface NodeSelectProps extends CommonProps {
  /** Hide offline nodes (default true; they are shown disabled otherwise). */
  onlineOnly?: boolean
  /** Nodes to leave out (e.g. the migration source). */
  exclude?: readonly string[]
  /**
   * With several nodes, preselect the node pve-web is connected to
   * (/cluster/status `local`), else the first online one, like the official
   * create wizards. Without it only a single node is preselected.
   */
  preferLocal?: boolean
}

/** Cluster nodes with status and load. */
export function NodeSelect({
  value,
  onValueChange,
  autoSelect = true,
  emptyOption,
  onlineOnly = true,
  exclude,
  preferLocal = false,
  placeholder = '选择节点',
  disabled,
  className,
}: NodeSelectProps) {
  const { data, isPending } = useClusterResources({
    select: (all) => all.filter(isNode).sort((a, b) => a.node.localeCompare(b.node)),
  })
  const status = useClusterStatus({ enabled: preferLocal && autoSelect && !emptyOption })
  const localNode = status.data?.find((e) => e.type === 'node' && !!e.local)?.name
  const nodes = (data ?? []).filter((n) => !exclude?.includes(n.node) && (!onlineOnly || n.status === 'online'))
  const options: SelectOption[] = nodes.map((n) => ({
    value: n.node,
    label: n.node,
    icon: <StatusDot status={n.status} pulse={false} decorative />,
    description:
      n.status === 'online'
        ? `CPU ${formatPercent(n.cpu)} · 内存 ${formatPercent(ratio(n.mem, n.maxmem))}`
        : '离线',
    disabled: n.status !== 'online',
  }))
  const online = nodes.filter((n) => n.status === 'online').map((n) => n.node)
  const single = nodes.length === 1 ? nodes[0]?.node : undefined
  // Wait for /cluster/status (or its failure) so the local node wins over the first one.
  const preferred = preferLocal && !status.isPending ? (online.find((n) => n === localNode) ?? online[0]) : undefined
  useAutoSelect(autoSelect && !emptyOption, value, single ?? preferred, onValueChange)
  return (
    <SelectField
      value={value}
      onValueChange={onValueChange}
      options={options}
      emptyOption={emptyOption}
      loading={isPending}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  )
}
