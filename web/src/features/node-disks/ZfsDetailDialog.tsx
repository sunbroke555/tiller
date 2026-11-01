import type { CSSProperties } from 'react'
import { RefreshCw } from 'lucide-react'

import { useZfsPoolDetail } from '@/api/node-disks'
import { ErrorState } from '@/components/QueryState'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { flattenZfsTree, shortDevice, zfsErrorCount, zfsHealthTone, zfsScanInfo } from './model'
import { Fact, HealthBadge } from './shared'

const SCAN_LABEL = { scrub: '数据校验（scrub）', resilver: '重建（resilver）', other: '扫描', none: '扫描' } as const

/** zpool status: health, scan / scrub, status and action text, errors and the vdev tree. */
export function ZfsDetailDialog({
  node,
  pool,
  open,
  onOpenChange,
}: {
  node: string
  pool: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const detail = useZfsPoolDetail(node, open ? pool : null)
  const rows = flattenZfsTree(detail.data)
  const scan = zfsScanInfo(detail.data?.scan)
  const errors = zfsErrorCount(rows)

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={<span className="font-mono">{pool}</span>}
      description="ZFS 池状态"
      headerExtra={
        <Button variant="ghost" size="icon" onClick={() => void detail.refetch()} aria-label="刷新" title="刷新" className="pointer-coarse:size-11">
          <RefreshCw className={cn(detail.isFetching && 'animate-spin')} />
        </Button>
      }
      bodyClassName="grid content-start gap-5"
    >
      {detail.isPending ? (
        <div className="grid gap-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} compact />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Fact label="健康">
              <HealthBadge tone={zfsHealthTone(detail.data.state)}>{detail.data.state}</HealthBadge>
            </Fact>
            <Fact label="读写校验错误">
              <span className={cn('tabular', errors > 0 && 'text-destructive')}>{errors}</span>
            </Fact>
            <Fact label="错误" className="col-span-2 sm:col-span-1">
              {detail.data.errors || '—'}
            </Fact>
            <Fact label={SCAN_LABEL[scan.kind]} className="col-span-2 sm:col-span-3">
              {scan.inProgress && <span className="mr-1.5 text-warning-strong">进行中</span>}
              {scan.text || '还没有做过数据校验'}
            </Fact>
            {detail.data.status && (
              <Fact label="状态说明" className="col-span-2 sm:col-span-3">
                <span className="whitespace-pre-line">{detail.data.status}</span>
              </Fact>
            )}
            {detail.data.action && (
              <Fact label="建议操作" className="col-span-2 sm:col-span-3">
                <span className="whitespace-pre-line">{detail.data.action}</span>
              </Fact>
            )}
          </div>

          <section className="grid gap-2" aria-label="设备">
            <h3 className="text-sm font-medium">设备</h3>
            <div className="overflow-hidden rounded-xl ring-1 ring-border/60 ring-inset">
              <div
                aria-hidden
                className="hidden grid-cols-[minmax(0,1fr)_6rem_3rem_3rem_3rem] gap-2 border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground sm:grid"
              >
                <span>名称</span>
                <span>状态</span>
                <span className="text-right">读</span>
                <span className="text-right">写</span>
                <span className="text-right">校验</span>
              </div>
              <ul aria-label="vdev" className="divide-y divide-border/50">
                {rows.map((r) => (
                  <li
                    key={r.key}
                    style={{ '--indent': `${r.depth * 14}px` } as CSSProperties}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_6rem_3rem_3rem_3rem]"
                  >
                    <span className="col-span-2 min-w-0 pl-(--indent) sm:col-span-1">
                      <span className={cn('block break-all sm:truncate', r.leaf ? 'font-mono' : 'font-medium')} title={r.name}>
                        {r.leaf ? shortDevice(r.name) : r.name}
                      </span>
                      {r.msg && <span className="block text-[11px] break-all text-muted-foreground sm:truncate">{r.msg}</span>}
                    </span>
                    <span className="pl-(--indent) sm:pl-0">{r.state && <HealthBadge tone={zfsHealthTone(r.state)}>{r.state}</HealthBadge>}</span>
                    <span className="text-right text-muted-foreground tabular sm:hidden">
                      {r.state ? `读 ${r.read ?? 0} · 写 ${r.write ?? 0} · 校验 ${r.cksum ?? 0}` : ''}
                    </span>
                    <span className="hidden text-right tabular sm:block">{r.read ?? ''}</span>
                    <span className="hidden text-right tabular sm:block">{r.write ?? ''}</span>
                    <span className="hidden text-right tabular sm:block">{r.cksum ?? ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}
    </ResponsiveDialog>
  )
}
