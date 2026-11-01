import type { ReactNode } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'

import { useAptChangelog, type AptUpdate } from '@/api/node-updates'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'

import { isKernelPackage, originLabel } from './updates'

/** Package details and its changelog (GET apt/changelog name + new version). */
export function ChangelogDialog({
  node,
  update,
  open,
  onOpenChange,
}: {
  node: string
  update: AptUpdate | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const changelog = useAptChangelog(node, update?.Package ?? '', update?.Version ?? '', { enabled: open && !!update })

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={<span className="font-mono">{update?.Package}</span>}
      description={update?.Title}
      bodyClassName="flex min-h-0 flex-col gap-4"
      footer={
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      }
    >
      {update && (
        <>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Fact label="当前版本" mono>
              {update.OldVersion ?? '—'}
            </Fact>
            <Fact label="新版本" mono>
              {update.Version}
            </Fact>
            <Fact label="来源">{originLabel(update.Origin ?? '')}</Fact>
            <Fact label="分区 / 架构">{[update.Section, update.Arch].filter(Boolean).join(' · ') || '—'}</Fact>
          </div>
          {isKernelPackage(update.Package) && (
            <p className="text-xs text-warning-strong">这是内核软件包：升级后需要重启节点才会使用新内核。</p>
          )}
          {update.Description && update.Description !== update.Title && (
            <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{update.Description}</p>
          )}
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <h3 className="text-sm font-medium">变更日志</h3>
            <div
              className="h-[46dvh] overflow-auto rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/60 ring-inset lg:h-[26rem] paper:bg-secondary/50"
              role="region"
              aria-label="变更日志"
              tabIndex={0}
            >
              {changelog.isPending ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" /> 正在读取变更日志…
                </div>
              ) : changelog.isError ? (
                <div className="grid justify-items-start gap-3 text-sm">
                  <p className="text-destructive">无法读取变更日志：{errorMessage(changelog.error)}</p>
                  <Button variant="outline" size="sm" onClick={() => void changelog.refetch()}>
                    <RefreshCw /> 重试
                  </Button>
                </div>
              ) : (
                <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{changelog.data || '没有变更日志。'}</pre>
              )}
            </div>
          </div>
        </>
      )}
    </ResponsiveDialog>
  )
}

function Fact({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-border/60 ring-inset paper:bg-secondary/50">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={mono ? 'mt-0.5 truncate font-mono text-xs tabular' : 'mt-0.5 truncate text-[13px]'} title={typeof children === 'string' ? children : undefined}>
        {children}
      </div>
    </div>
  )
}
