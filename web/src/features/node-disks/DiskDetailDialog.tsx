import { useState } from 'react'
import { Activity, Eraser, RefreshCw, TableProperties } from 'lucide-react'

import { diskKeys, initGpt, useDiskSmart, wipeDisk, type DiskEntry } from '@/api/node-disks'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/QueryState'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DASH, formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  canInitGpt,
  diskInUse,
  diskTypeLabel,
  diskUsageLabel,
  isPartition,
  parseSmart,
  smartHealthLabel,
  smartHealthTone,
  truthy,
  wearoutLeft,
  type SmartAttribute,
} from './model'
import { Fact, HealthBadge, useDiskPermissions } from './shared'

interface Props {
  node: string
  disk: DiskEntry | null
  partitions: readonly DiskEntry[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenPartition: (devpath: string) => void
}

/** Disk / partition details, its partitions, actions (GPT, wipe) and S.M.A.R.T. values. */
export function DiskDetailDialog({ node, disk, partitions, open, onOpenChange, onOpenPartition }: Props) {
  const perms = useDiskPermissions()
  const [confirm, setConfirm] = useState<'gpt' | 'wipe' | null>(null)
  if (!disk) return null
  const part = isPartition(disk)
  const life = wearoutLeft(disk.wearout)
  const invalidate = [diskKeys.all(node)]
  const gptAllowed = canInitGpt(disk)

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={onOpenChange}
        size="xl"
        title={<span className="font-mono">{disk.devpath}</span>}
        description={part ? `${disk.parent} 上的分区` : [disk.vendor?.trim(), disk.model].filter(Boolean).join(' ') || diskTypeLabel(disk.type)}
        bodyClassName="grid content-start gap-5"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Fact label="类型">{part ? '分区' : diskTypeLabel(disk.type)}</Fact>
          <Fact label="大小">{formatBytes(disk.size)}</Fact>
          <Fact label="用途">{diskUsageLabel(disk)}</Fact>
          <Fact label="GPT">{truthy(disk.gpt) ? '是' : '否'}</Fact>
          {disk.mounted !== undefined && <Fact label="已挂载">{truthy(disk.mounted) ? '是' : '否'}</Fact>}
          {!part && (
            <>
              <Fact label="S.M.A.R.T.">
                <HealthBadge tone={smartHealthTone(disk.health)}>{smartHealthLabel(disk.health)}</HealthBadge>
              </Fact>
              <Fact label="剩余寿命">{life !== null ? `${life}%` : '不适用'}</Fact>
              {typeof disk.rpm === 'number' && disk.rpm > 0 && <Fact label="转速">{disk.rpm} rpm</Fact>}
              <Fact label="厂商">{disk.vendor?.trim() || DASH}</Fact>
              <Fact label="型号">{disk.model || DASH}</Fact>
              <Fact label="序列号" mono>
                {disk.serial || DASH}
              </Fact>
              {disk.wwn && disk.wwn !== 'unknown' && (
                <Fact label="WWN" mono>
                  {disk.wwn}
                </Fact>
              )}
              {disk.by_id_link && (
                <Fact label="by-id" mono className="col-span-2 sm:col-span-3">
                  {disk.by_id_link}
                </Fact>
              )}
            </>
          )}
        </div>

        {(perms.modify || perms.wipe) && (
          <div className="flex flex-wrap gap-2 *:flex-1 sm:*:flex-none">
            {!part && perms.modify && (
              <Button
                variant="outline"
                disabled={!gptAllowed}
                title={gptAllowed ? undefined : '只有未使用的整块磁盘可以初始化'}
                onClick={() => setConfirm('gpt')}
                className="pointer-coarse:h-11"
              >
                <TableProperties /> 初始化 GPT
              </Button>
            )}
            {perms.wipe && (
              <Button variant="outline" className="text-destructive hover:text-destructive pointer-coarse:h-11" onClick={() => setConfirm('wipe')}>
                <Eraser /> 擦除{part ? '分区' : '磁盘'}
              </Button>
            )}
          </div>
        )}
        {!part && perms.modify && !gptAllowed && (
          <p className="-mt-3 text-xs text-muted-foreground">磁盘正在使用，不能初始化 GPT。要重新使用它，先擦除磁盘。</p>
        )}

        {partitions.length > 0 && (
          <section className="grid gap-2" aria-label="分区">
            <h3 className="text-sm font-medium">分区</h3>
            <ul className="divide-y divide-border/60 rounded-xl ring-1 ring-border/60 ring-inset">
              {partitions.map((p) => (
                <li key={p.devpath}>
                  <button
                    type="button"
                    onClick={() => onOpenPartition(p.devpath)}
                    className="flex min-h-11 w-full items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors hover:bg-foreground/[0.03]"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{p.devpath}</span>
                    <span className="truncate text-xs text-muted-foreground">{diskUsageLabel(p)}</span>
                    <span className="w-20 text-right text-xs tabular">{formatBytes(p.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!part && <SmartSection node={node} disk={disk.devpath} />}
      </ResponsiveDialog>

      <ConfirmDialog
        open={confirm === 'gpt'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`初始化 ${disk.devpath}？`}
        description="在磁盘上写入新的空 GPT 分区表，之后可以用它创建存储。"
        confirmLabel="初始化"
        onConfirm={() => runTask(initGpt(node, disk.devpath), { title: `初始化 GPT ${disk.devpath}`, node, invalidate })}
      />
      <ConfirmDialog
        open={confirm === 'wipe'}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive
        typeToConfirm={disk.devpath}
        title={`擦除 ${disk.devpath}？`}
        description={
          <span className="grid gap-2">
            <span>清除分区表、文件系统和 LVM / ZFS 签名，设备上的所有数据都会丢失。</span>
            <span className="grid gap-0.5 text-xs">
              <span>类型：{part ? '分区' : diskTypeLabel(disk.type)}</span>
              <span>用途：{partitions.length ? `分区（${partitions.map(diskUsageLabel).join('、')}）` : diskUsageLabel(disk)}</span>
              <span>大小：{formatBytes(disk.size)}</span>
              {disk.serial && <span>序列号：{disk.serial}</span>}
            </span>
            {(diskInUse(disk) || partitions.some(diskInUse)) && (
              <span className="text-destructive">这个设备正在使用。挂载中或被占用（LVM、ZFS）的设备会被拒绝。</span>
            )}
          </span>
        }
        confirmLabel="擦除"
        onConfirm={() => runTask(wipeDisk(node, disk.devpath), { title: `擦除 ${disk.devpath}`, node, invalidate })}
      />
    </>
  )
}

function SmartSection({ node, disk }: { node: string; disk: string }) {
  const smart = useDiskSmart(node, disk)
  const view = parseSmart(smart.data)
  return (
    <section className="grid gap-2" aria-label="S.M.A.R.T. 值">
      <div className="flex min-h-9 items-center gap-2">
        <h3 className="flex flex-1 items-center gap-1.5 text-sm font-medium">
          <Activity className="size-4 text-muted-foreground" aria-hidden /> S.M.A.R.T. 值
          {smart.data && (
            <HealthBadge tone={smartHealthTone(view.health)} className="ml-2 text-xs font-normal">
              {smartHealthLabel(view.health)}
            </HealthBadge>
          )}
        </h3>
        <Button variant="ghost" size="sm" onClick={() => void smart.refetch()} disabled={smart.isFetching} className="pointer-coarse:h-11">
          <RefreshCw className={cn(smart.isFetching && 'animate-spin')} /> 刷新
        </Button>
      </div>
      {smart.isPending ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : smart.isError ? (
        <ErrorState error={smart.error} onRetry={() => void smart.refetch()} compact />
      ) : view.kind === 'text' ? (
        <pre className="max-h-[50dvh] overflow-auto rounded-xl bg-foreground/[0.04] p-3 font-mono text-xs leading-relaxed whitespace-pre ring-1 ring-border/60 ring-inset paper:bg-secondary/50">
          {view.text.trim() || '（无输出）'}
        </pre>
      ) : view.kind === 'attributes' ? (
        <SmartTable attributes={view.attributes} />
      ) : (
        <p className="text-sm text-muted-foreground">没有 S.M.A.R.T. 值。</p>
      )}
    </section>
  )
}

function SmartTable({ attributes }: { attributes: readonly SmartAttribute[] }) {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-border/60 ring-inset">
      <div
        aria-hidden
        className="hidden grid-cols-[2.5rem_minmax(0,1fr)_7rem_3.5rem_3.5rem_3.5rem_4.5rem_6rem] gap-2 border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground sm:grid"
      >
        <span className="text-right">ID</span>
        <span>属性</span>
        <span>值</span>
        <span className="text-right">标准值</span>
        <span className="text-right">最差</span>
        <span className="text-right">阈值</span>
        <span>标志</span>
        <span>失败</span>
      </div>
      <ul className="max-h-[50dvh] divide-y divide-border/50 overflow-y-auto" aria-label="S.M.A.R.T. 属性">
        {attributes.map((a) => (
          <li
            key={`${a.id}-${a.name}`}
            className={cn(
              'grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-2 px-3 py-2 text-xs sm:grid-cols-[2.5rem_minmax(0,1fr)_7rem_3.5rem_3.5rem_3.5rem_4.5rem_6rem] sm:items-center',
              a.failing && 'bg-destructive/10',
            )}
          >
            <span className="text-right text-muted-foreground tabular">{a.id ?? ''}</span>
            <span className="truncate font-medium" title={a.name}>
              {a.name}
            </span>
            <span className="truncate text-right font-mono sm:text-left" title={a.value}>
              {a.value}
            </span>
            {/* Phones: one detail line under the name */}
            <span className="col-span-2 col-start-2 text-[11px] text-muted-foreground sm:hidden">
              标准值 {a.normalized} · 最差 {a.worst} · 阈值 {a.threshold}
              {a.failing && <span className="text-destructive"> · 失败 {a.fail}</span>}
            </span>
            <span className="hidden text-right tabular sm:block">{a.normalized}</span>
            <span className="hidden text-right tabular sm:block">{a.worst}</span>
            <span className="hidden text-right tabular sm:block">{a.threshold}</span>
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">{a.flags}</span>
            <span className={cn('hidden sm:block', a.failing ? 'text-destructive' : 'text-muted-foreground')}>{a.fail || '-'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
