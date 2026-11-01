import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronRight, FileText, Play, RefreshCw, RotateCcw, Search, Square } from 'lucide-react'

import {
  DISRUPTIVE_SERVICES,
  SERVICE_COMMAND_LABEL,
  UNIT_STATE_LABEL,
  nodeKeys,
  serviceCommand,
  serviceCommands,
  serviceInstalled,
  serviceState,
  useNodeServices,
  type NodeService,
  type ServiceCommand,
  type ServiceTone,
} from '@/api/node-summary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { fireTask, runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import type { NodeTabProps } from '@/features/node/types'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { JournalView } from './JournalView'

const TONE_DOT: Record<ServiceTone, string> = {
  ok: 'bg-success shadow-[0_0_0_3px] shadow-success/15',
  off: 'bg-faint',
  bad: 'bg-destructive shadow-[0_0_0_3px] shadow-destructive/15',
  warn: 'bg-warning',
  unknown: 'bg-muted-foreground',
}
const TONE_TEXT: Record<ServiceTone, string> = {
  ok: 'text-success-strong',
  off: 'text-muted-foreground',
  bad: 'text-destructive',
  warn: 'text-warning-strong',
  unknown: 'text-muted-foreground',
}

const COMMAND_ICON: Record<ServiceCommand, typeof Play> = {
  start: Play,
  stop: Square,
  restart: RotateCcw,
  reload: RefreshCw,
}

/** Commands that ask first: stopping anything, and restarting what the UI itself depends on. */
export function needsConfirm(service: string, cmd: ServiceCommand): boolean {
  return cmd === 'stop' || (cmd === 'restart' && DISRUPTIVE_SERVICES.has(service))
}

function confirmText(s: NodeService, cmd: ServiceCommand, node: string) {
  const disruptive = DISRUPTIVE_SERVICES.has(s.service)
  if (cmd === 'stop') {
    return {
      title: `停止服务 ${s.name}？`,
      description: disruptive
        ? `${s.name} 是 Proxmox VE 的核心服务，停止后 ${node} 的管理功能会受影响。`
        : `${s.desc ?? s.name} 将被停止，直到手动启动或节点重启。`,
    }
  }
  return {
    title: `重启服务 ${s.name}？`,
    description:
      s.service === 'pveproxy'
        ? '重启 pveproxy 会断开当前所有网页连接，几秒后自动恢复。只想重新读取配置时可以用“重新加载”。'
        : `重启 ${s.name} 可能让正在进行的管理操作中断。只想重新读取配置时可以用“重新加载”。`,
  }
}

interface PendingCmd {
  service: NodeService
  cmd: ServiceCommand
}

function useServiceRunner(node: string) {
  const [pending, setPending] = useState<PendingCmd | null>(null)
  const [last, setLast] = useState<PendingCmd | null>(null)
  if (pending && pending !== last) setLast(pending)

  const opts = (s: NodeService, cmd: ServiceCommand) => ({
    title: `${SERVICE_COMMAND_LABEL[cmd]}服务 ${s.name}`,
    invalidate: [nodeKeys.services(node)],
  })
  const trigger = (s: NodeService, cmd: ServiceCommand) => {
    if (needsConfirm(s.service, cmd)) setPending({ service: s, cmd })
    else fireTask(serviceCommand(node, s.service, cmd), opts(s, cmd))
  }
  const text = last ? confirmText(last.service, last.cmd, node) : null
  const host = last && text && (
    <ConfirmDialog
      open={pending === last}
      onOpenChange={(o) => !o && setPending(null)}
      title={text.title}
      description={text.description}
      confirmLabel={SERVICE_COMMAND_LABEL[last.cmd]}
      destructive={last.cmd === 'stop'}
      onConfirm={() => runTask(serviceCommand(node, last.service.service, last.cmd), opts(last.service, last.cmd))}
    />
  )
  return { trigger, host }
}

function StateDot({ tone }: { tone: ServiceTone }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', TONE_DOT[tone])} />
}

function CommandButtons({
  service,
  onCommand,
  compact,
  className,
}: {
  service: NodeService
  onCommand: (s: NodeService, cmd: ServiceCommand) => void
  /** Icon buttons with tooltips (desktop rows); otherwise labelled buttons. */
  compact?: boolean
  className?: string
}) {
  const cmds = serviceCommands(service)
  return (
    <div className={cn('flex flex-wrap gap-2', compact && 'gap-1', className)}>
      {cmds.map((cmd) => {
        const Icon = COMMAND_ICON[cmd]
        const label = `${SERVICE_COMMAND_LABEL[cmd]} ${service.name}`
        return (
          <Button
            key={cmd}
            variant={compact ? 'ghost' : 'outline'}
            size={compact ? 'icon' : 'default'}
            className={cn(compact && 'text-muted-foreground hover:text-foreground', cmd === 'stop' && 'text-destructive hover:text-destructive')}
            onClick={(e) => {
              e.stopPropagation()
              onCommand(service, cmd)
            }}
            aria-label={label}
            title={compact ? SERVICE_COMMAND_LABEL[cmd] : undefined}
          >
            <Icon className={cmd === 'stop' ? 'fill-current' : undefined} />
            {!compact && SERVICE_COMMAND_LABEL[cmd]}
          </Button>
        )
      })}
    </div>
  )
}

/** Node services: state, start / stop / restart / reload, per-service log. */
export default function ServicesTab({ node }: NodeTabProps) {
  const services = useNodeServices(node)
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const [openName, setOpenName] = useState<string | null>(null)
  const [lastOpen, setLastOpen] = useState<string | null>(null)
  if (openName && openName !== lastOpen) setLastOpen(openName)
  const runner = useServiceRunner(node)

  const all = services.data ?? []
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((s) => showAll || serviceInstalled(s))
      .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.desc ?? '').toLowerCase().includes(q))
  }, [all, showAll, query])
  const hidden = all.filter((s) => !serviceInstalled(s)).length
  const running = all.filter((s) => s.state === 'running').length
  const failed = all.filter((s) => s['active-state'] === 'failed').length
  const selected = all.find((s) => s.service === lastOpen)

  if (services.isError && !services.data) {
    return (
      <GlassCard>
        <EmptyState
          icon={AlertTriangle}
          title="无法读取服务列表"
          description={errorMessage(services.error)}
          action={
            <Button variant="outline" onClick={() => void services.refetch()}>
              <RefreshCw /> 重试
            </Button>
          }
        />
      </GlassCard>
    )
  }

  return (
    <div className="grid gap-(--row-gap)">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索服务"
            aria-label="搜索服务"
            className="pl-9"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {services.data && (
            <span className="tabular">
              {running} 个运行中{failed > 0 && <span className="text-destructive"> · {failed} 个失败</span>}
            </span>
          )}
          {hidden > 0 && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2">
              <Switch checked={showAll} onCheckedChange={setShowAll} aria-label="显示未安装的服务" />
              显示未安装（{hidden}）
            </label>
          )}
        </div>
      </div>

      <GlassCard flush className="overflow-hidden">
        {services.isPending ? (
          <div className="grid gap-px">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="m-3 h-10 rounded-lg" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={Search} title="没有匹配的服务" />
        ) : (
          <ul className="divide-y divide-border/60" aria-label="服务">
            {list.map((s) => {
              const st = serviceState(s)
              const unitLabel = s['unit-state'] ? (UNIT_STATE_LABEL[s['unit-state']] ?? s['unit-state']) : null
              return (
                <li key={s.service} className={cn(!serviceInstalled(s) && 'opacity-60')}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenName(s.service)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenName(s.service)
                      }
                    }}
                    aria-label={`${s.name}，${st.label}`}
                    className="group flex min-h-14 cursor-pointer items-center gap-3 px-(--card-p) py-(--row-py) transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset paper:hover:bg-secondary/50"
                  >
                    <StateDot tone={st.tone} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate font-mono text-[13px] font-medium">{s.name}</span>
                        <span className={cn('shrink-0 text-xs lg:hidden', TONE_TEXT[st.tone])}>{st.label}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{s.desc}</div>
                    </div>
                    <div className="hidden w-20 shrink-0 text-xs lg:block">
                      <span className={TONE_TEXT[st.tone]}>{st.label}</span>
                    </div>
                    <div className="hidden w-20 shrink-0 text-xs text-muted-foreground lg:block">{unitLabel}</div>
                    <CommandButtons service={s} onCommand={runner.trigger} compact className="hidden w-30 justify-end lg:flex" />
                    <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </GlassCard>

      <ResponsiveDialog
        open={!!openName}
        onOpenChange={(o) => !o && setOpenName(null)}
        size="xl"
        title={<span className="font-mono">{selected?.name ?? lastOpen}</span>}
        description={selected?.desc}
        bodyClassName="flex min-h-0 flex-col gap-4"
      >
        {selected && (
          <>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Fact label="状态">
                <span className={cn('inline-flex items-center gap-1.5', TONE_TEXT[serviceState(selected).tone])}>
                  <StateDot tone={serviceState(selected).tone} /> {serviceState(selected).label}
                </span>
              </Fact>
              <Fact label="活动状态">{selected['active-state'] ?? '—'}</Fact>
              <Fact label="单元">{selected['unit-state'] ? (UNIT_STATE_LABEL[selected['unit-state']] ?? selected['unit-state']) : '—'}</Fact>
            </div>
            {serviceCommands(selected).length > 0 ? (
              <CommandButtons service={selected} onCommand={runner.trigger} className="*:flex-1 sm:*:flex-none" />
            ) : (
              <p className="text-sm text-muted-foreground">这个服务未安装或已屏蔽，不能启动。</p>
            )}
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <FileText className="size-4 text-muted-foreground" aria-hidden /> 服务日志
              </h3>
              <JournalView node={node} unit={selected.service} className="h-[52dvh] lg:h-[28rem]" />
            </div>
          </>
        )}
      </ResponsiveDialog>
      {runner.host}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-border/60 ring-inset paper:bg-secondary/50">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-[13px]">{children}</div>
    </div>
  )
}
