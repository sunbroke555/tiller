import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Database, Folder, Layers, SquareDashed, type LucideIcon } from 'lucide-react'

import { useDirectoryMounts, useLvmThinPools, useLvmTree, useZfsPools, type DiskStorageKind } from '@/api/node-disks'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { UsageBar } from '@/components/UsageBar'
import { formatBytes } from '@/lib/format'

import { CreateSimpleDialog, CreateZfsDialog } from './CreateDialogs'
import { DestroyDialog, type DestroyTarget } from './DestroyDialog'
import { directoryName, fraction, lvmVolumeGroups, zfsHealthTone } from './model'
import { DeleteButton, HealthBadge, Num, useDiskPermissions, ViewHeader } from './shared'
import { ZfsDetailDialog } from './ZfsDetailDialog'

interface ViewProps {
  node: string
}

/** Create + destroy dialog state shared by the four storage views. */
function useStorageDialogs(node: string, kind: DiskStorageKind) {
  const perms = useDiskPermissions()
  const [creating, setCreating] = useState(false)
  const [destroy, setDestroy] = useState<DestroyTarget | null>(null)
  const [lastDestroy, setLastDestroy] = useState<DestroyTarget | null>(null)
  if (destroy && destroy !== lastDestroy) setLastDestroy(destroy)
  const host = (
    <>
      {kind === 'zfs' ? (
        <CreateZfsDialog node={node} open={creating} onOpenChange={setCreating} />
      ) : (
        <CreateSimpleDialog node={node} kind={kind} open={creating} onOpenChange={setCreating} />
      )}
      <DestroyDialog node={node} target={lastDestroy} open={!!destroy} onOpenChange={(o) => !o && setDestroy(null)} />
    </>
  )
  return {
    onCreate: perms.modify ? () => setCreating(true) : undefined,
    askDestroy: perms.modify ? setDestroy : undefined,
    host,
  }
}

function ListCard<T>({
  query,
  items,
  empty,
  icon,
  label,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }
  items: readonly T[]
  empty: string
  icon: LucideIcon
  label: string
  children: (item: T) => ReactNode
}) {
  return (
    <GlassCard flush className="overflow-hidden">
      {query.isPending ? (
        <LoadingRows rows={2} className="p-3" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
      ) : items.length === 0 ? (
        <EmptyState icon={icon} title={empty} />
      ) : (
        <ul className="divide-y divide-border/60" aria-label={label}>
          {items.map(children)}
        </ul>
      )}
    </GlassCard>
  )
}

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand-strong ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/70 paper:ring-border"
    >
      <Icon className="size-4" />
    </span>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Num className="text-foreground/90">{children}</Num>
    </span>
  )
}

// ------------------------------------------------------------------- LVM

export function LvmView({ node }: ViewProps) {
  const lvm = useLvmTree(node)
  const vgs = useMemo(() => lvmVolumeGroups(lvm.data), [lvm.data])
  const d = useStorageDialogs(node, 'lvm')
  return (
    <div className="grid gap-2">
      <ViewHeader
        title="LVM 卷组"
        count={lvm.data ? vgs.length : undefined}
        onRefresh={() => void lvm.refetch()}
        refreshing={lvm.isFetching}
        createLabel="创建卷组"
        onCreate={d.onCreate}
      />
      <ListCard query={lvm} items={vgs} empty="没有 LVM 卷组" icon={Layers} label="LVM 卷组">
        {(vg) => (
          <li key={vg.name} className="grid gap-2.5 px-(--card-p) py-(--row-py)">
            <div className="flex min-h-9 items-center gap-3">
              <RowIcon icon={Layers} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px] font-medium">{vg.name}</div>
                <div className="flex flex-wrap gap-x-3">
                  <Stat label="LV">{vg.lvcount ?? 0}</Stat>
                  <Stat label="大小">{formatBytes(vg.size)}</Stat>
                  <Stat label="空闲">{formatBytes(vg.free)}</Stat>
                </div>
              </div>
              {d.askDestroy && (
                <DeleteButton label={`删除卷组 ${vg.name}`} onClick={() => d.askDestroy?.({ kind: 'lvm', name: vg.name, label: vg.name })} />
              )}
            </div>
            <UsageBar label="已分配给 LV" value={fraction(vg.size - vg.free, vg.size)} detail={`${formatBytes(vg.size - vg.free)} / ${formatBytes(vg.size)}`} size="sm" />
            {vg.children.length > 0 && (
              <ul aria-label={`${vg.name} 的物理卷`} className="grid gap-1 border-l border-border/70 pl-3 sm:ml-11">
                {vg.children.map((pv) => (
                  <li key={pv.name} className="flex items-baseline gap-3 text-xs">
                    <span className="min-w-0 flex-1 truncate font-mono">{pv.name}</span>
                    <Stat label="大小">{formatBytes(pv.size)}</Stat>
                    <Stat label="空闲">{formatBytes(pv.free)}</Stat>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
      </ListCard>
      {d.host}
    </div>
  )
}

// -------------------------------------------------------------- LVM-Thin

export function LvmThinView({ node }: ViewProps) {
  const thin = useLvmThinPools(node)
  const pools = useMemo(() => [...(thin.data ?? [])].sort((a, b) => `${a.vg}/${a.lv}`.localeCompare(`${b.vg}/${b.lv}`)), [thin.data])
  const d = useStorageDialogs(node, 'lvmthin')
  return (
    <div className="grid gap-2">
      <ViewHeader
        title="LVM-Thin 池"
        count={thin.data ? pools.length : undefined}
        onRefresh={() => void thin.refetch()}
        refreshing={thin.isFetching}
        createLabel="创建 Thin 池"
        onCreate={d.onCreate}
      />
      <ListCard query={thin} items={pools} empty="没有 LVM-Thin 池" icon={SquareDashed} label="LVM-Thin 池">
        {(t) => (
          <li key={`${t.vg}/${t.lv}`} className="grid gap-2.5 px-(--card-p) py-(--row-py)">
            <div className="flex min-h-9 items-center gap-3">
              <RowIcon icon={SquareDashed} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px] font-medium">{t.lv}</div>
                <div className="text-xs text-muted-foreground">
                  卷组 <span className="font-mono text-foreground/90">{t.vg}</span>
                </div>
              </div>
              {d.askDestroy && (
                <DeleteButton
                  label={`删除 Thin 池 ${t.vg}/${t.lv}`}
                  onClick={() => d.askDestroy?.({ kind: 'lvmthin', name: t.lv, label: `${t.vg}/${t.lv}`, volumeGroup: t.vg })}
                />
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 sm:pl-11">
              <UsageBar label="数据" value={fraction(t.used, t.lv_size)} detail={`${formatBytes(t.used)} / ${formatBytes(t.lv_size)}`} size="sm" />
              <UsageBar
                label="元数据"
                value={fraction(t.metadata_used, t.metadata_size)}
                detail={`${formatBytes(t.metadata_used)} / ${formatBytes(t.metadata_size)}`}
                size="sm"
              />
            </div>
          </li>
        )}
      </ListCard>
      {d.host}
    </div>
  )
}

// ------------------------------------------------------------- directory

export function DirectoryView({ node }: ViewProps) {
  const dirs = useDirectoryMounts(node)
  const list = useMemo(() => [...(dirs.data ?? [])].sort((a, b) => a.path.localeCompare(b.path)), [dirs.data])
  const d = useStorageDialogs(node, 'directory')
  return (
    <div className="grid gap-2">
      <ViewHeader
        title="目录"
        count={dirs.data ? list.length : undefined}
        onRefresh={() => void dirs.refetch()}
        refreshing={dirs.isFetching}
        createLabel="创建目录"
        onCreate={d.onCreate}
      />
      <ListCard query={dirs} items={list} empty="没有由 PVE 管理的目录" icon={Folder} label="目录">
        {(m) => {
          const name = directoryName(m.path)
          return (
            <li key={m.path} className="flex min-h-14 items-center gap-3 px-(--card-p) py-(--row-py)">
              <RowIcon icon={Folder} />
              <div className="grid min-w-0 flex-1 gap-0.5 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1.4fr)_4rem_minmax(6rem,1fr)] lg:items-center lg:gap-3">
                <span className="truncate font-mono text-[13px] font-medium">{m.path}</span>
                <span className="truncate font-mono text-xs text-muted-foreground" title={m.device}>
                  {m.device}
                </span>
                <span className="text-xs">
                  {m.type}
                  <span className="text-muted-foreground lg:hidden"> · {m.options}</span>
                </span>
                <span className="hidden truncate text-xs text-muted-foreground lg:block" title={m.unitfile}>
                  {m.options}
                </span>
              </div>
              {d.askDestroy && <DeleteButton label={`删除目录 ${name}`} onClick={() => d.askDestroy?.({ kind: 'directory', name, label: name })} />}
            </li>
          )
        }}
      </ListCard>
      {d.host}
    </div>
  )
}

// ------------------------------------------------------------------- ZFS

export function ZfsView({ node }: ViewProps) {
  const zfs = useZfsPools(node)
  const pools = useMemo(() => [...(zfs.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [zfs.data])
  const d = useStorageDialogs(node, 'zfs')
  const [detail, setDetail] = useState<string | null>(null)
  const [lastDetail, setLastDetail] = useState<string | null>(null)
  if (detail && detail !== lastDetail) setLastDetail(detail)
  return (
    <div className="grid gap-2">
      <ViewHeader
        title="ZFS 池"
        count={zfs.data ? pools.length : undefined}
        onRefresh={() => void zfs.refetch()}
        refreshing={zfs.isFetching}
        createLabel="创建 ZFS 池"
        onCreate={d.onCreate}
      />
      <ListCard query={zfs} items={pools} empty="没有 ZFS 池" icon={Database} label="ZFS 池">
        {(pool) => (
          <li key={pool.name}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setDetail(pool.name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setDetail(pool.name)
                }
              }}
              aria-label={`${pool.name}，${pool.health}`}
              className="group grid cursor-pointer gap-2.5 px-(--card-p) py-(--row-py) outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] paper:hover:bg-secondary/50"
            >
              <div className="flex min-h-9 items-center gap-3">
                <RowIcon icon={Database} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-[13px] font-medium">{pool.name}</span>
                    <HealthBadge tone={zfsHealthTone(pool.health)} className="text-xs">
                      {pool.health}
                    </HealthBadge>
                  </div>
                  <div className="flex flex-wrap gap-x-3">
                    <Stat label="大小">{formatBytes(pool.size)}</Stat>
                    <Stat label="空闲">{formatBytes(pool.free)}</Stat>
                    <Stat label="碎片">{pool.frag}%</Stat>
                    <Stat label="去重">{Number(pool.dedup).toFixed(2)}x</Stat>
                  </div>
                </div>
                {d.askDestroy && (
                  <DeleteButton label={`删除 ZFS 池 ${pool.name}`} onClick={() => d.askDestroy?.({ kind: 'zfs', name: pool.name, label: pool.name })} />
                )}
                <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
              </div>
              <UsageBar
                label="已分配"
                value={fraction(pool.alloc, pool.size)}
                detail={`${formatBytes(pool.alloc)} / ${formatBytes(pool.size)}`}
                size="sm"
                className="sm:pl-11"
              />
            </div>
          </li>
        )}
      </ListCard>
      <ZfsDetailDialog node={node} pool={lastDetail} open={!!detail} onOpenChange={(o) => !o && setDetail(null)} />
      {d.host}
    </div>
  )
}
