import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, ChevronRight, LoaderCircle, PackageCheck, PackageSearch, RefreshCw, Search, ShieldOff, SquareTerminal } from 'lucide-react'
import { toast } from 'sonner'

import { nodeKeys } from '@/api/node-summary'
import { refreshPackageIndex, updateKeys, useAptUpdates, type AptUpdate } from '@/api/node-updates'
import { useSession } from '@/api/useSession'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { openTaskLog, runTask } from '@/components/tasks/tracker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { ChangelogDialog } from './ChangelogDialog'
import { nodeUpgradePath, UPGRADE_USER } from './paths'
import { filterUpdates, groupUpdates, isKernelPackage, originLabel } from './updates'

/** Pending updates (GET apt/update) grouped by origin, with refresh, upgrade and changelogs. */
export function PackageUpdates({ node, canModify }: { node: string; canModify: boolean }) {
  const updates = useAptUpdates(node, { enabled: canModify })
  const [query, setQuery] = useState('')
  const [details, setDetails] = useState(false)
  const [open, setOpen] = useState<AptUpdate | null>(null)
  const [last, setLast] = useState<AptUpdate | null>(null)
  if (open && open !== last) setLast(open)

  const all = updates.data
  const groups = useMemo(() => groupUpdates(filterUpdates(all ?? [], query, { description: details })), [all, query, details])
  const shown = groups.reduce((n, g) => n + g.items.length, 0)
  const kernel = (all ?? []).some((u) => isKernelPackage(u.Package))
  const root = useSession()?.username === UPGRADE_USER

  if (!canModify) {
    return (
      <GlassCard>
        <EmptyState
          icon={ShieldOff}
          title="没有权限"
          description="查看和安装更新需要这个节点上的 Sys.Modify 权限。软件源和软件包版本仍可查看。"
        />
      </GlassCard>
    )
  }

  return (
    <div className="grid gap-(--row-gap)">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索软件包"
            aria-label="搜索软件包"
            className="pl-9"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <RefreshButton node={node} className="flex-1 sm:flex-none" />
        <UpgradeButton node={node} root={root} className="flex-1 sm:flex-none" />
      </div>
      {!root && <p className="-mt-1 text-xs text-muted-foreground">只有 root@pam 可以通过 Shell 升级软件包。</p>}

      {updates.isError && !all ? (
        <ErrorCard error={updates.error} onRetry={() => void updates.refetch()} title="无法读取可更新的软件包" />
      ) : updates.isPending ? (
        <GlassCard flush>
          <LoadingRows rows={6} />
        </GlassCard>
      ) : all && all.length === 0 ? (
        <GlassCard>
          <EmptyState
            icon={PackageCheck}
            title="没有可用的更新"
            description="软件包都是最新的。点“刷新”从软件源重新同步软件包索引。"
          />
        </GlassCard>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular" data-testid="updates-count">
              {query.trim() ? `${shown} / ${all?.length ?? 0} 个软件包` : `${all?.length ?? 0} 个软件包可更新`}
            </span>
            {kernel && <span className="text-warning-strong">包含内核更新，升级后需要重启节点才能生效</span>}
            <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-9">
              <Switch checked={details} onCheckedChange={setDetails} aria-label="显示详细描述" />
              显示详细描述
            </label>
          </div>

          {groups.length === 0 ? (
            <GlassCard>
              <EmptyState icon={PackageSearch} title="没有匹配的软件包" />
            </GlassCard>
          ) : (
            groups.map((g) => (
              <section key={g.origin} aria-label={`来源 ${originLabel(g.origin)}`} className="grid gap-2">
                <h3 className="flex items-baseline gap-2 px-1 text-sm font-medium">
                  {originLabel(g.origin)}
                  <span className="text-xs font-normal text-muted-foreground tabular">{g.items.length} 个</span>
                </h3>
                <GlassCard flush className="overflow-hidden">
                  <ul className="divide-y divide-border/60" aria-label={`${originLabel(g.origin)} 软件包`}>
                    {g.items.map((u) => (
                      <UpdateRow key={u.Package} update={u} details={details} onOpen={() => setOpen(u)} />
                    ))}
                  </ul>
                </GlassCard>
              </section>
            ))
          )}
        </>
      )}

      <ChangelogDialog node={node} update={last} open={!!open} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  )
}

function UpdateRow({ update: u, details, onOpen }: { update: AptUpdate; details: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${u.Package}，${u.OldVersion ?? '未安装'} 更新到 ${u.Version}`}
        className="group flex min-h-14 w-full items-center gap-3 px-(--card-p) py-(--row-py) text-left transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] paper:hover:bg-secondary/50"
      >
        <div className="min-w-0 flex-1 lg:grid lg:grid-cols-[minmax(12rem,16rem)_1fr] lg:items-baseline lg:gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[13px] font-medium">{u.Package}</span>
            {isKernelPackage(u.Package) && (
              <Badge variant="outline" className="shrink-0 border-warning/40 text-[10px] font-normal text-warning-strong">
                需重启
              </Badge>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs text-muted-foreground lg:text-[13px]">{u.Title}</div>
            {details && u.Description && (
              <p className="mt-1 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">{u.Description}</p>
            )}
          </div>
          <Versions update={u} className="mt-1 lg:hidden" />
        </div>
        <Versions update={u} className="hidden w-80 shrink-0 justify-end lg:flex" />
        <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
      </button>
    </li>
  )
}

function Versions({ update: u, className }: { update: AptUpdate; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5 font-mono text-[11px] tabular lg:text-xs', className)}>
      <span className="truncate text-muted-foreground">{u.OldVersion ?? '—'}</span>
      <ArrowRight className="size-3 shrink-0 text-faint" aria-hidden />
      <span className="truncate text-foreground">{u.Version}</span>
    </div>
  )
}

/** POST apt/update: apt-get update as a task, its log opened right away (like the official TaskViewer). */
function RefreshButton({ node, className }: { node: string; className?: string }) {
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    const title = `刷新软件包索引（${node}）`
    setBusy(true)
    try {
      const handle = await runTask(refreshPackageIndex(node), {
        title,
        invalidate: [updateKeys.updates(node), nodeKeys.aptVersions(node)],
      })
      if (handle.upid) openTaskLog({ node, upid: handle.upid, title })
      await handle.done
    } catch (e) {
      toast.error('刷新失败', { description: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" onClick={() => void refresh()} disabled={busy} className={className}>
      {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
      {busy ? '正在刷新…' : '刷新'}
    </Button>
  )
}

/** Opens the node shell running pveupgrade (apt-get dist-upgrade asks before it changes anything). */
function UpgradeButton({ node, root, className }: { node: string; root: boolean; className?: string }) {
  const navigate = useNavigate()
  return (
    <Button
      onClick={() => navigate(nodeUpgradePath(node))}
      disabled={!root}
      title="在节点 Shell 中运行 apt-get dist-upgrade"
      className={className}
    >
      <SquareTerminal /> 升级
    </Button>
  )
}
