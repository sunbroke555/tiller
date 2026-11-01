import { Fragment, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Cable,
  ChevronRight,
  Ellipsis,
  EthernetPort,
  Merge,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'

import { deleteIface, useNodeNetwork, type NetworkIface } from '@/api/node-network'
import { usePermissions } from '@/api/permissions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import type { NodeTabProps } from '@/features/node/types'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { IfaceDialog, type IfaceDialogTarget } from './IfaceDialog'
import {
  BOND_MODE_LABEL,
  CREATE_TYPES,
  DEFAULT_NAME_PREFIX,
  GROUPS,
  PENDING_LABEL,
  groupOf,
  isEditable,
  membersOf,
  nextFreeName,
  parsePendingDiff,
  typeLabel,
  type CreateType,
  type PendingKind,
} from './model'
import { PendingChanges } from './PendingChanges'
import { networkInvalidate } from './shared'

const TYPE_ICON: Record<string, LucideIcon> = {
  eth: EthernetPort,
  bridge: Network,
  OVSBridge: Network,
  bond: Merge,
  OVSBond: Merge,
  vlan: Tag,
  OVSPort: Cable,
  OVSIntPort: Cable,
}

const isOn = (v: unknown) => v === 1 || v === '1' || v === true

/** Node → Network: interfaces, pending changes, create / edit / delete, apply and revert. */
export default function NetworkTab({ node }: NodeTabProps) {
  const query = useNodeNetwork(node)
  const canModify = usePermissions().can({ privs: 'Sys.Modify' }, { kind: 'node', node })
  const [dialog, setDialog] = useState<{ target: IfaceDialogTarget; open: boolean } | null>(null)
  const [removing, setRemoving] = useState<{ iface: NetworkIface; open: boolean } | null>(null)

  const ifaces = useMemo(() => query.data?.ifaces ?? [], [query.data])
  const changes = query.data?.changes ?? ''
  const pending = useMemo(
    () => parsePendingDiff(changes, new Set(ifaces.filter((i) => i.type === 'eth').map((i) => i.iface))),
    [changes, ifaces],
  )
  const names = useMemo(() => new Set(ifaces.map((i) => i.iface)), [ifaces])

  const openCreate = (type: CreateType) => {
    const prefix = DEFAULT_NAME_PREFIX[type]
    setDialog({ target: { type, name: prefix ? nextFreeName(prefix, names) : '' }, open: true })
  }
  const openEdit = (iface: NetworkIface) => {
    if (canModify && isEditable(iface.type)) setDialog({ target: { type: iface.type, iface }, open: true })
  }

  if (query.isError && !query.data) {
    return (
      <GlassCard>
        <EmptyState
          icon={AlertTriangle}
          title="无法读取网络配置"
          description={errorMessage(query.error)}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw /> 重试
            </Button>
          }
        />
      </GlassCard>
    )
  }

  // Interfaces removed in interfaces.new are no longer listed: show them from the diff.
  const removed = [...pending.ifaces].filter(([n, k]) => k === 'removed' && !names.has(n)).map(([n]) => n)
  const gatewayIfaces = ifaces.filter((i) => i.gateway || i.gateway6).map((i) => i.iface)
  const risky = [...pending.ifaces.keys()].filter((n) => gatewayIfaces.includes(n))
  const active = ifaces.filter((i) => isOn(i.active)).length

  const grouped = [
    ...GROUPS.map((g) => ({ id: g.id, title: g.title, items: ifaces.filter((i) => groupOf(i.type) === g.id) })),
    { id: 'other', title: '其他', items: ifaces.filter((i) => groupOf(i.type) === 'other') },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="grid gap-(--row-gap)">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs text-muted-foreground tabular">
          {query.data ? `${ifaces.length} 个接口 · ${active} 个活动` : '读取中…'}
        </p>
        {canModify && <CreateMenu onPick={openCreate} />}
      </div>

      {changes && <PendingChanges node={node} diff={changes} pending={pending} canModify={canModify} riskyIfaces={risky} />}

      {query.isPending ? (
        <GlassCard flush className="grid gap-px overflow-hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="m-3 h-11 rounded-lg" />
          ))}
        </GlassCard>
      ) : ifaces.length === 0 && removed.length === 0 ? (
        <GlassCard>
          <EmptyState icon={Network} title="没有网络接口" />
        </GlassCard>
      ) : (
        <>
          {grouped.map((g) => (
            <section key={g.id} aria-labelledby={`net-group-${g.id}`} className="grid gap-2">
              <h2 id={`net-group-${g.id}`} className="px-1 text-sm font-medium text-muted-foreground paper:text-base paper:text-foreground">
                {g.title}
                <span className="ml-1.5 text-xs font-normal tabular">{g.items.length}</span>
              </h2>
              <GlassCard flush className="overflow-hidden">
                <ul className="divide-y divide-border/60" aria-label={g.title}>
                  {g.items.map((i) => (
                    <IfaceRow
                      key={i.iface}
                      iface={i}
                      pending={pending.ifaces.get(i.iface)}
                      canModify={canModify}
                      onEdit={() => openEdit(i)}
                      onRemove={() => setRemoving({ iface: i, open: true })}
                    />
                  ))}
                </ul>
              </GlassCard>
            </section>
          ))}
          {removed.length > 0 && (
            <section aria-labelledby="net-group-removed" className="grid gap-2">
              <h2 id="net-group-removed" className="px-1 text-sm font-medium text-muted-foreground">
                待删除
              </h2>
              <GlassCard flush className="overflow-hidden">
                <ul className="divide-y divide-border/60" aria-label="待删除">
                  {removed.map((n) => (
                    <li key={n} className="flex min-h-14 items-center gap-3 px-(--card-p) py-(--row-py) opacity-70">
                      <span aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-destructive" />
                      <span className="flex-1 truncate font-mono text-[13px] line-through">{n}</span>
                      <PendingBadge kind="removed" />
                    </li>
                  ))}
                </ul>
              </GlassCard>
            </section>
          )}
        </>
      )}

      <IfaceDialog
        node={node}
        target={dialog?.target}
        ifaces={ifaces}
        open={!!dialog?.open}
        onOpenChange={(open) => setDialog((d) => (d ? { ...d, open } : d))}
      />
      <ConfirmDialog
        open={!!removing?.open}
        onOpenChange={(open) => setRemoving((r) => (r ? { ...r, open } : r))}
        title={`删除 ${removing?.iface.iface ?? ''}？`}
        description={removing ? removeDescription(removing.iface) : undefined}
        confirmLabel="删除"
        destructive
        onConfirm={async () => {
          if (!removing) return
          await runTask(deleteIface(node, removing.iface.iface), {
            title: `删除 ${typeLabel(removing.iface.type)} ${removing.iface.iface}`,
            invalidate: networkInvalidate(node),
            syncSuccessMessage: '已删除，应用配置后生效',
          })
        }}
      />
    </div>
  )
}

function removeDescription(i: NetworkIface): string {
  const parts = [`${typeLabel(i.type)} ${i.iface} 会从待应用配置中移除，应用配置后生效。`]
  if (i.gateway || i.gateway6) parts.push('它承载默认网关，应用后节点可能失联。')
  else if (i.cidr || i.cidr6) parts.push(`它的地址 ${[i.cidr, i.cidr6].filter(Boolean).join('、')} 也会一起移除。`)
  return parts.join('')
}

function CreateMenu({ onPick }: { onPick: (t: CreateType) => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="pointer-coarse:h-10">
          <Plus /> 创建
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {CREATE_TYPES.map((t, idx) => {
          const Icon = TYPE_ICON[t] ?? Network
          return (
            <Fragment key={t}>
              {idx === 3 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => onPick(t)} className="pointer-coarse:py-2.5">
                <Icon />
                {typeLabel(t)}
              </DropdownMenuItem>
            </Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PendingBadge({ kind }: { kind: PendingKind }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px]',
        kind === 'removed' ? 'bg-destructive/12 text-destructive' : 'bg-warning/12 text-warning-strong',
      )}
    >
      {PENDING_LABEL[kind]}
    </span>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'muted' | 'brand' }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px]',
        tone === 'brand' ? 'bg-brand/10 text-brand-strong paper:bg-primary/10 paper:text-primary' : 'bg-secondary text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

/** One-line description of what the interface is made of. */
function detailParts(i: NetworkIface): string[] {
  const members = membersOf(i)
  const parts: string[] = []
  switch (i.type) {
    case 'bridge':
    case 'OVSBridge':
      parts.push(members.length ? `端口 ${members.join(' ')}` : '无端口')
      break
    case 'bond':
    case 'OVSBond':
      parts.push(members.length ? `成员 ${members.join(' ')}` : '无成员')
      if (i.bond_mode) parts.push(BOND_MODE_LABEL[i.bond_mode] ?? i.bond_mode)
      if (i.bond_xmit_hash_policy) parts.push(i.bond_xmit_hash_policy)
      if (i['bond-primary']) parts.push(`主 ${i['bond-primary']}`)
      break
    case 'vlan': {
      const raw = i['vlan-raw-device'] ?? /(\w+)\.\d+/.exec(i.iface)?.[1]
      const id = i['vlan-id'] ?? /\.(\d+)$/.exec(i.iface)?.[1] ?? /^vlan(\d+)/.exec(i.iface)?.[1]
      parts.push([id && `VLAN ${id}`, raw && `@ ${raw}`].filter(Boolean).join(' '))
      break
    }
    case 'eth':
      if (i.altnames?.length) parts.push(i.altnames.join(' · '))
      break
  }
  if (i.ovs_bridge) parts.push(`OVS 网桥 ${i.ovs_bridge}`)
  if (i.ovs_tag) parts.push(`标签 ${i.ovs_tag}`)
  if (i.bridge_vids) parts.push(`VID ${i.bridge_vids}`)
  if (i.mtu) parts.push(`MTU ${i.mtu}`)
  return parts.filter(Boolean)
}

function IfaceRow({
  iface: i,
  pending,
  canModify,
  onEdit,
  onRemove,
}: {
  iface: NetworkIface
  pending: PendingKind | undefined
  canModify: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const Icon = TYPE_ICON[i.type] ?? Waypoints
  const editable = canModify && isEditable(i.type)
  const isActive = isOn(i.active)
  const missing = i.type === 'eth' && i.exists !== undefined && !isOn(i.exists)
  const details = detailParts(i)
  const comment = i.comments?.trim()
  const addresses = [i.cidr, i.cidr6].filter(Boolean) as string[]
  const gateways = [i.gateway, i.gateway6].filter(Boolean) as string[]
  const state = isActive ? '活动' : pending === 'added' ? '未应用' : '未激活'

  const body = (
    <>
      <span className="relative shrink-0" aria-hidden>
        <span
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-xl ring-1 ring-inset',
            isActive
              ? 'bg-brand/10 text-brand-strong ring-brand/15 paper:bg-secondary paper:text-foreground/70 paper:ring-border'
              : 'bg-secondary text-muted-foreground ring-border/60',
          )}
        >
          <Icon className="size-4.5" />
        </span>
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background',
            isActive ? 'bg-success' : 'bg-faint',
          )}
        />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-mono text-[13px] font-medium">{i.iface}</span>
          <span className="text-xs text-muted-foreground">{typeLabel(i.type)}</span>
          {!isActive && <Chip>{state}</Chip>}
          {isOn(i.autostart) && <Chip>自启</Chip>}
          {isOn(i.bridge_vlan_aware) && <Chip tone="brand">VLAN 感知</Chip>}
          {missing && <Chip>网卡不存在</Chip>}
          {pending && <PendingBadge kind={pending} />}
        </span>
        {details.length > 0 && <span className="truncate text-xs text-muted-foreground">{details.join(' · ')}</span>}
        {addresses.length > 0 && (
          <span className="truncate font-mono text-xs lg:hidden">
            {addresses.join('  ')}
            {gateways.length > 0 && <span className="font-sans text-muted-foreground"> · 网关 {gateways.join(' ')}</span>}
          </span>
        )}
        {comment && <span className="truncate text-xs text-muted-foreground italic">{comment}</span>}
      </span>
      <span className="hidden w-48 shrink-0 font-mono text-xs lg:grid">
        {addresses.length ? addresses.map((a) => <span key={a} className="truncate">{a}</span>) : <span className="text-faint">—</span>}
      </span>
      <span className="hidden w-36 shrink-0 font-mono text-xs text-muted-foreground lg:grid">
        {gateways.length ? gateways.map((g) => <span key={g} className="truncate">{g}</span>) : <span className="text-faint">—</span>}
      </span>
    </>
  )

  return (
    <li className="flex items-stretch">
      {editable ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`编辑 ${i.iface}`}
          className="group flex min-h-14 min-w-0 flex-1 items-center gap-3 py-(--row-py) pl-(--card-p) text-left transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] paper:hover:bg-secondary/50"
        >
          {body}
          <ChevronRight className="hidden size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 lg:block" aria-hidden />
        </button>
      ) : (
        <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-(--row-py) pr-(--card-p) pl-(--card-p)">{body}</div>
      )}
      {editable && (
        <div className="flex shrink-0 items-center pr-1.5">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`更多操作：${i.iface}`} className="size-11 text-muted-foreground">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuLabel className="font-mono text-xs text-muted-foreground">{i.iface}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={onEdit} className="pointer-coarse:py-2.5">
                <Pencil /> 编辑
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove} className="pointer-coarse:py-2.5">
                <Trash2 /> 删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  )
}
