// PCI / USB / directory mappings: one card per logical mapping with its
// per-node entries and whether each entry still matches the host.

import { useQueries } from '@tanstack/react-query'
import { Pencil, Plus, Server, Trash2 } from 'lucide-react'

import { get, p } from '@/api/client'
import { usePermissions } from '@/api/permissions'
import { useClusterResources } from '@/api/queries'
import { qemuConfigKeys, type HostPciDevice, type HostUsbDevice } from '@/api/qemu-config'
import { mappingApi, useMappingList, type ClusterMapping, type MappingKind } from '@/api/resource-mappings'
import { isNode } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { SectionHeader } from '@/components/PageHeader'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'

import {
  checkDirItem,
  checkPciItem,
  checkUsbItem,
  groupByNode,
  removalRequest,
  removeEntry,
  removeNodeEntries,
  usbDeviceId,
  usbPortPath,
  type EntryStatus,
  type MapItem,
} from './logic'
import { MappingDialog, type MappingTarget } from './MappingDialog'
import { KIND_META, mappingWrite } from './meta'
import { Chip, EntryStatusLine, RowMenu, useDialog, type RowAction } from './ui'

interface Removal {
  mapping: ClusterMapping
  /** Remove the whole mapping, one node's entries, or one entry. */
  scope: { kind: 'all' } | { kind: 'node'; node: string } | { kind: 'entry'; item: MapItem }
}

export function MappingsView({ kind }: { kind: MappingKind }) {
  const meta = KIND_META[kind]
  const query = useMappingList(kind)
  const perms = usePermissions()
  const canCreate = perms.can({ privs: 'Mapping.Modify', path: `/mapping/${kind}` })
  const canModify = (id: string) => perms.can({ privs: 'Mapping.Modify', path: [`/mapping/${kind}/${id}`, `/mapping/${kind}`] })
  const edit = useDialog<MappingTarget>()
  const remove = useDialog<Removal>()

  const { data: nodes = [] } = useClusterResources({ select: (all) => all.filter(isNode).sort((a, b) => a.node.localeCompare(b.node)) })
  const mappings = [...(query.data ?? [])].sort((a, b) => a.id.localeCompare(b.id))
  const status = useEntryStatus(kind, mappings, nodes)

  const add = canCreate ? (
    <Button size="sm" onClick={() => edit.show({ mode: 'create' })} className="pointer-coarse:h-10">
      <Plus /> 添加{meta.noun}
    </Button>
  ) : undefined

  let body
  if (query.isPending) {
    body = (
      <GlassCard flush>
        <LoadingRows rows={3} />
      </GlassCard>
    )
  } else if (query.isError) {
    body = <ErrorCard error={query.error} onRetry={() => void query.refetch()} />
  } else if (mappings.length === 0) {
    body = (
      <GlassCard>
        <EmptyState
          icon={meta.icon}
          title={`没有${meta.noun}`}
          description={meta.empty}
          action={
            canCreate ? (
              <Button onClick={() => edit.show({ mode: 'create' })}>
                <Plus /> 添加{meta.noun}
              </Button>
            ) : undefined
          }
        />
      </GlassCard>
    )
  } else {
    body = (
      <div className="grid gap-3">
        {mappings.map((m) => (
          <MappingCard
            key={m.id}
            kind={kind}
            mapping={m}
            nodeCount={nodes.length}
            canEdit={canModify(m.id)}
            canDelete={canCreate}
            status={status}
            onEdit={(target) => edit.show(target)}
            onRemove={(scope) => remove.show({ mapping: m, scope })}
          />
        ))}
      </div>
    )
  }

  const r = remove.data
  return (
    <section aria-label={meta.title} className="min-w-0">
      <SectionHeader title={query.data ? `${meta.title} ${mappings.length}` : meta.title} className="mb-2.5 min-h-9">
        {add}
      </SectionHeader>
      {body}

      <MappingDialog {...edit.props} kind={kind} target={edit.data ?? { mode: 'create' }} />
      <ConfirmDialog
        {...remove.props}
        destructive
        confirmLabel="删除"
        title={
          !r
            ? ''
            : r.scope.kind === 'all'
              ? `删除${meta.noun} ${r.mapping.id}？`
              : r.scope.kind === 'node'
                ? `移除 ${r.mapping.id} 在 ${r.scope.node} 上的映射？`
                : `移除 ${r.mapping.id} 的 ${entryLabel(kind, r.scope.item)}？`
        }
        description={
          r?.scope.kind === 'all'
            ? '引用这个映射的虚拟机将无法启动，直到重新创建同名映射。'
            : '这是该映射的最后一项时，整个映射会被删除。'
        }
        typeToConfirm={r?.scope.kind === 'all' ? r.mapping.id : undefined}
        onConfirm={async () => {
          if (!r) return
          const { mapping, scope } = r
          const remaining =
            scope.kind === 'all' ? [] : scope.kind === 'node' ? removeNodeEntries(mapping.map, scope.node) : removeEntry(mapping.map, scope.item.raw)
          const req = removalRequest(mapping, remaining)
          if (req.method === 'DELETE') await mappingWrite(mappingApi.remove(kind, mapping.id), `删除${meta.noun} ${mapping.id}`)
          else await mappingWrite(mappingApi.update(kind, mapping.id, req.params), `修改${meta.noun} ${mapping.id}`)
        }}
      />
    </section>
  )
}

export function entryLabel(kind: MappingKind, item: MapItem): string {
  if (kind === 'usb') return item.path ? `端口 ${item.path}` : `设备 ${item.id ?? ''}`
  return item.path ?? ''
}

// ------------------------------------------------------------------ card

function MappingCard({
  kind,
  mapping,
  nodeCount,
  canEdit,
  canDelete,
  status,
  onEdit,
  onRemove,
}: {
  kind: MappingKind
  mapping: ClusterMapping
  nodeCount: number
  canEdit: boolean
  canDelete: boolean
  status: StatusLookup
  onEdit: (target: MappingTarget) => void
  onRemove: (scope: Removal['scope']) => void
}) {
  const groups = groupByNode(mapping.map)
  const allStatus = groups.flatMap((g) => g.items.map((i) => status(mapping, i)))
  const bad = allStatus.filter((s) => s.state === 'error').length
  const mdev = mapping.mdev === true || mapping.mdev === 1
  const actions: RowAction[] = []
  if (canEdit) {
    actions.push({ id: 'edit', label: '编辑', icon: Pencil, onSelect: () => onEdit({ mode: 'global', mapping }) })
    actions.push({
      id: 'add-node',
      label: '添加节点映射',
      icon: Plus,
      onSelect: () => onEdit({ mode: 'add-node', mapping }),
      disabled: nodeCount > 0 && groups.length >= nodeCount ? '每个节点都已映射' : false,
    })
  }
  if (canDelete) actions.push({ id: 'delete', label: '删除映射', icon: Trash2, destructive: true, separated: true, onSelect: () => onRemove({ kind: 'all' }) })

  return (
    <GlassCard flush className="overflow-hidden" data-mapping={mapping.id}>
      <div className="flex min-w-0 items-start gap-2 px-(--card-p) pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 truncate font-mono text-[15px] font-medium text-foreground">{mapping.id}</h3>
            {mdev && <Chip tone="brand">中介设备</Chip>}
            {!!mapping['live-migration-capable'] && <Chip tone="brand">可实时迁移</Chip>}
            {bad > 0 && <Chip tone="warning">{bad} 项不匹配</Chip>}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {mapping.description || `${groups.length} 个节点 · ${allStatus.length} 项`}
          </p>
        </div>
        <RowMenu label={mapping.id} actions={actions} className="-mt-1.5 -mr-2" />
      </div>
      <div className="divide-y divide-border/60 border-t border-border/60">
        {groups.length === 0 && <p className="px-(--card-p) py-3 text-xs text-muted-foreground">没有任何节点的映射。</p>}
        {groups.map((g) => (
          <div key={g.node} className="grid gap-1 px-(--card-p) py-2.5" data-node={g.node}>
            <div className="flex min-h-9 items-center gap-2">
              <Server className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.node}</span>
              {canEdit && (
                <RowMenu
                  label={`${mapping.id} · ${g.node}`}
                  className="-mr-2"
                  actions={[
                    { id: 'edit-node', label: '编辑此节点', icon: Pencil, onSelect: () => onEdit({ mode: 'node', mapping, node: g.node }) },
                    ...(g.items.length > 1
                      ? g.items.map((item, i) => ({
                          id: `rm-${i}`,
                          label: `移除 ${entryLabel(kind, item)}`,
                          icon: Trash2,
                          destructive: true,
                          separated: i === 0,
                          onSelect: () => onRemove({ kind: 'entry', item }),
                        }))
                      : []),
                    { id: 'rm-node', label: '移除此节点的映射', icon: Trash2, destructive: true, separated: g.items.length <= 1, onSelect: () => onRemove({ kind: 'node', node: g.node }) },
                  ]}
                />
              )}
            </div>
            <ul className="grid gap-2 pb-0.5 pl-5.5">
              {g.items.map((item) => (
                <EntryRow key={item.raw} kind={kind} item={item} status={status(mapping, item)} detail={status.detail(item)} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}

function EntryRow({ kind, item, status, detail }: { kind: MappingKind; item: MapItem; status: EntryStatus; detail: string | undefined }) {
  const ids =
    kind === 'pci'
      ? [item.id && `ID ${item.id}`, item['subsystem-id'] && `子系统 ${item['subsystem-id']}`, item.iommugroup !== undefined && `IOMMU 组 ${item.iommugroup}`]
      : kind === 'usb'
        ? [item.path && `ID ${item.id ?? ''}`]
        : []
  const primary = kind === 'usb' ? (item.path ? `端口 ${item.path}` : (item.id ?? '')) : (item.path ?? '')
  return (
    <li className="grid min-w-0 gap-0.5" data-entry={item.raw}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="min-w-0 font-mono text-[13px] break-all text-foreground">{primary.replaceAll(';', ' ; ')}</span>
        {detail && <span className="min-w-0 truncate text-xs text-muted-foreground">{detail}</span>}
      </div>
      {ids.some(Boolean) && <div className="font-mono text-[11px] text-muted-foreground">{ids.filter(Boolean).join(' · ')}</div>}
      {item.description && <div className="text-xs text-muted-foreground">{item.description}</div>}
      <EntryStatusLine status={status} />
    </li>
  )
}

// --------------------------------------------------------------- status

interface StatusLookup {
  (mapping: ClusterMapping, item: MapItem): EntryStatus
  /** Device name on the host (PCI vendor/device, USB product). */
  detail: (item: MapItem) => string | undefined
}

/**
 * Per-node checks of every entry: PCI and USB compare with the node's
 * hardware list (like the official tree), directories ask the node itself
 * (GET /cluster/mapping/dir?check-node=<node>). Only online nodes that have
 * entries are queried; the queries share the VM editors' cache keys.
 */
function useEntryStatus(kind: MappingKind, mappings: ClusterMapping[], nodes: { node: string; status?: string }[]): StatusLookup {
  const used = new Set(mappings.flatMap((m) => groupByNode(m.map).map((g) => g.node)))
  const online = nodes.filter((n) => n.status === 'online' && used.has(n.node)).map((n) => n.node)
  const results = useQueries({
    queries: online.map((node) =>
      kind === 'pci'
        ? {
            queryKey: qemuConfigKeys.hostPci(node),
            queryFn: ({ signal }: { signal: AbortSignal }) =>
              get<HostPciDevice[]>(p`/nodes/${node}/hardware/pci`, { 'pci-class-blacklist': '' }, { signal }) as Promise<unknown>,
            staleTime: 30_000,
          }
        : kind === 'usb'
          ? {
              queryKey: qemuConfigKeys.hostUsb(node),
              queryFn: ({ signal }: { signal: AbortSignal }) => get<HostUsbDevice[]>(p`/nodes/${node}/hardware/usb`, undefined, { signal }) as Promise<unknown>,
              staleTime: 15_000,
            }
          : {
              queryKey: qemuConfigKeys.mappings('dir', node),
              queryFn: ({ signal }: { signal: AbortSignal }) =>
                get<ClusterMapping[]>(p`/cluster/mapping/dir`, { 'check-node': node }, { signal }) as Promise<unknown>,
              staleTime: 30_000,
            },
    ),
  })
  const byNode = new Map(online.map((node, i) => [node, results[i]!]))
  const known = new Set(nodes.map((n) => n.node))

  const lookup = ((mapping: ClusterMapping, item: MapItem): EntryStatus => {
    if (nodes.length && !known.has(item.node)) return { state: 'unknown', messages: ['集群中没有这个节点'] }
    const q = byNode.get(item.node)
    if (!q) return { state: 'unknown', messages: [nodes.length ? '节点离线，无法检查' : '检查中…'] }
    if (q.isPending) return { state: 'loading', messages: [] }
    if (q.isError) return { state: 'unknown', messages: [`无法检查：${errorMessage(q.error)}`] }
    if (kind === 'pci') return checkPciItem(item, q.data as HostPciDevice[], mapping.mdev === true || mapping.mdev === 1)
    if (kind === 'usb') return checkUsbItem(item, q.data as HostUsbDevice[])
    const own = (q.data as ClusterMapping[]).find((m) => m.id === mapping.id)
    return checkDirItem(own?.checks ?? own?.errors)
  }) as StatusLookup

  lookup.detail = (item: MapItem) => {
    const data = byNode.get(item.node)?.data
    if (!data) return undefined
    if (kind === 'pci') {
      const path = (item.path ?? '').split(';')[0] ?? ''
      const dev = (data as HostPciDevice[]).find((d) => d.id === (/\.[0-9a-f]$/i.test(path) ? path : `${path}.0`))
      return dev ? [dev.vendor_name, dev.device_name].filter(Boolean).join(' ') || undefined : undefined
    }
    if (kind === 'usb') {
      const list = data as HostUsbDevice[]
      const dev = (item.path ? list.find((d) => usbPortPath(d) === item.path) : undefined) ?? list.find((d) => usbDeviceId(d) === item.id?.toLowerCase())
      return dev ? [dev.manufacturer, dev.product].filter(Boolean).join(' ') || undefined : undefined
    }
    return undefined
  }
  return lookup
}
