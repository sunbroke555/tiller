import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileCode2, Plus, RefreshCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'

import { useNodeSubscription } from '@/api/node-summary'
import { setRepositoryEnabled, updateKeys, useAptRepositoryConfig, type AptRepositories } from '@/api/node-updates'
import { GlassCard } from '@/components/GlassCard'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { AddRepositoryDialog } from './AddRepositoryDialog'
import {
  classifyOrigin,
  componentNotice,
  formatRepoOptions,
  repoFileGroups,
  repoState,
  type RepoHealth,
  type RepoRow,
} from './updates'

const HEALTH: Record<RepoHealth, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  good: { icon: CheckCircle2, cls: 'text-success-strong', label: '正常' },
  warning: { icon: AlertTriangle, cls: 'text-warning-strong', label: '警告' },
  critical: { icon: XCircle, cls: 'text-destructive', label: '错误' },
}

/** APT repositories (Proxmox.node.APTRepositories): status, files, enable / disable, add standard repositories. */
export function Repositories({ node, canModify }: { node: string; canModify: boolean }) {
  const repos = useAptRepositoryConfig(node)
  const [adding, setAdding] = useState(false)

  return (
    <div className="grid gap-(--section-gap)">
      {repos.isError && !repos.data ? (
        <ErrorCard error={repos.error} onRetry={() => void repos.refetch()} title="无法读取软件源配置" />
      ) : !repos.data ? (
        <>
          <GlassCard>
            <Skeleton className="h-24 rounded-xl" />
          </GlassCard>
          <GlassCard flush>
            <LoadingRows rows={4} />
          </GlassCard>
        </>
      ) : (
        <>
          <RepoStatusCard node={node} data={repos.data} />
          <div className="grid gap-(--row-gap)">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-sm font-medium">软件源文件</h2>
              <Button variant="outline" onClick={() => void repos.refetch()} disabled={repos.isFetching}>
                <RefreshCw className={cn(repos.isFetching && 'animate-spin')} /> 重新读取
              </Button>
              {canModify && (
                <Button onClick={() => setAdding(true)}>
                  <Plus /> 添加软件源
                </Button>
              )}
            </div>
            <RepoFiles node={node} data={repos.data} canModify={canModify} />
          </div>
          {canModify && <AddRepositoryDialog node={node} data={repos.data} open={adding} onOpenChange={setAdding} />}
        </>
      )}
    </div>
  )
}

function RepoStatusCard({ node, data }: { node: string; data: AptRepositories }) {
  const sub = useNodeSubscription(node)
  // The official panel treats "not known yet" as no subscription, too.
  const active = sub.data?.status?.toLowerCase() === 'active'
  const state = useMemo(() => repoState(data, active), [data, active])
  const H = HEALTH[state.status]
  return (
    <GlassCard role="region" aria-label="软件源状态" className="grid gap-4 lg:grid-cols-[minmax(14rem,18rem)_1fr] lg:items-start">
      <div className="flex items-center gap-3 lg:flex-col lg:items-center lg:py-2 lg:text-center">
        <H.icon className={cn('size-8 shrink-0 lg:size-12', H.cls)} aria-hidden />
        <div className="min-w-0">
          <div className="text-[15px] font-medium" data-testid="repo-state">
            {state.text}
          </div>
          <div className="text-xs text-muted-foreground">
            订阅：{sub.isPending ? '读取中' : active ? '有效' : '无有效订阅'}
          </div>
        </div>
      </div>
      {state.messages.length > 0 && (
        <ul className="grid gap-1.5" aria-label="软件源检查结果">
          {state.messages.map((m, i) => {
            const M = HEALTH[m.status]
            return (
              <li
                key={i}
                className={cn(
                  'flex items-start gap-2.5 rounded-xl px-3 py-2 text-[13px] ring-1 ring-inset',
                  m.status === 'good' && 'bg-success/8 ring-success/20',
                  m.status === 'warning' && 'bg-warning/10 ring-warning/25',
                  m.status === 'critical' && 'bg-destructive/10 ring-destructive/25',
                )}
              >
                <M.icon className={cn('mt-0.5 size-4 shrink-0', M.cls)} aria-label={M.label} />
                <span className="min-w-0 break-words">{m.message}</span>
              </li>
            )
          })}
        </ul>
      )}
    </GlassCard>
  )
}

function RepoFiles({ node, data, canModify }: { node: string; data: AptRepositories; canModify: boolean }) {
  const groups = useMemo(() => repoFileGroups(data), [data])
  const [pending, setPending] = useState<string | null>(null)

  const toggle = async (row: RepoRow, enabled: boolean) => {
    setPending(row.key)
    try {
      await runTask(setRepositoryEnabled(node, { path: row.path, index: row.index, enabled, digest: data.digest }), {
        title: `${enabled ? '启用' : '禁用'}软件源`,
        syncSuccessMessage: `已${enabled ? '启用' : '禁用'}软件源 ${row.repo.Components?.join(' ') ?? row.repo.URIs[0] ?? ''}`.trim(),
        invalidate: [updateKeys.repositories(node)],
      })
    } catch (e) {
      toast.error(`${enabled ? '启用' : '禁用'}软件源失败`, { description: errorMessage(e) })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="grid gap-(--row-gap)">
      {groups.map((g) => (
        <GlassCard key={g.path} flush className="overflow-hidden" role="region" aria-label={`文件 ${g.path}`}>
          <div className="flex items-center gap-2 border-b border-border/60 px-(--card-p) py-2.5">
            <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 font-mono text-xs break-all" title={g.path}>
              {g.path}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular">{g.rows.length} 个软件源</span>
          </div>
          {g.error && (
            <p className="flex items-start gap-2 px-(--card-p) py-3 text-[13px] text-destructive">
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> 解析失败：{g.error}
            </p>
          )}
          <ul className="divide-y divide-border/60" aria-label={`${g.path} 中的软件源`}>
            {g.rows.map((row) => (
              <RepoRowItem
                key={row.key}
                row={row}
                fileType={g.fileType}
                canModify={canModify}
                busy={pending === row.key}
                onToggle={(on) => void toggle(row, on)}
              />
            ))}
          </ul>
        </GlassCard>
      ))}
    </div>
  )
}

function OriginBadge({ origin }: { origin: string }) {
  const type = classifyOrigin(origin)
  return (
    <Badge
      variant="outline"
      className={cn(
        'shrink-0 text-[10px] font-normal',
        type === 'Proxmox' && 'border-brand/30 text-brand-strong',
        type === 'Debian' && 'border-destructive/25 text-foreground/80',
      )}
    >
      {origin || '其他'}
    </Badge>
  )
}

function RepoRowItem({
  row,
  fileType,
  canModify,
  busy,
  onToggle,
}: {
  row: RepoRow
  fileType: string
  canModify: boolean
  busy: boolean
  onToggle: (enabled: boolean) => void
}) {
  const { repo } = row
  const notice = componentNotice(repo.Components)
  const suiteWarnings = row.warnings.filter((w) => w.property === 'Suites')
  const otherWarnings = row.warnings.filter((w) => w.property !== 'Suites')
  const options = formatRepoOptions(repo.Options, fileType)
  const name = `${repo.URIs.join(' ')} ${(repo.Components ?? []).join(' ')}`.trim()

  return (
    <li className="flex items-start gap-3 px-(--card-p) py-(--row-py)" data-testid="repo-row" data-enabled={row.enabled ? '1' : '0'}>
      <div className={cn('min-w-0 flex-1 space-y-1', !row.enabled && 'opacity-60')}>
        <div className="flex flex-wrap items-center gap-1.5">
          {(repo.Components ?? []).map((c) => (
            <span key={c} className="rounded-md bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-xs font-medium paper:bg-secondary">
              {c}
            </span>
          ))}
          {notice && (
            <span className="inline-flex items-center gap-1 text-[11px] text-warning-strong">
              <AlertTriangle className="size-3.5" aria-hidden /> {notice.message}
            </span>
          )}
          <OriginBadge origin={row.origin} />
          {!row.enabled && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              已禁用
            </Badge>
          )}
        </div>
        <div className="font-mono text-xs break-all text-foreground/90">{repo.URIs.join(' ')}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>
            类型 <span className="font-mono text-foreground/80">{repo.Types.join(' ')}</span>
          </span>
          <span className={cn(suiteWarnings.length > 0 && (row.enabled ? 'text-destructive' : 'text-warning-strong'))}>
            套件 <span className="font-mono">{repo.Suites.join(' ')}</span>
          </span>
          {options.map((o) => (
            <span key={o} className="font-mono break-all">
              {o}
            </span>
          ))}
        </div>
        {repo.Comment && <div className="text-xs whitespace-pre-line text-muted-foreground"># {repo.Comment.trim()}</div>}
        {[...suiteWarnings, ...otherWarnings].map((w, i) => (
          <div
            key={i}
            className={cn('flex items-start gap-1.5 text-xs', row.enabled ? 'text-destructive' : 'text-warning-strong')}
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="break-words">{w.message}</span>
          </div>
        ))}
      </div>
      <Switch
        checked={row.enabled}
        disabled={!canModify || busy}
        onCheckedChange={onToggle}
        aria-label={`启用 ${name}`}
        className="mt-1 shrink-0"
      />
    </li>
  )
}
