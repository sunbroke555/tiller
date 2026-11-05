import { Suspense, lazy, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronRight, Server, SquareTerminal } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { isGuest, isNode, type GuestResource, type NodeResource } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { formatPercent, formatUptime, ratio } from '@/lib/format'
import { GUEST_TYPE_LABEL, byVmid, consolePath, guestName, nodeShellPath, statusLabel } from '@/lib/resources'
import { cn } from '@/lib/utils'
import { METRIC_TEXT, usageTone } from '@/lib/metric-status'

// The console UI (and xterm.js behind it) loads only when a shell is shown.
const ConsoleScreen = lazy(() => import('@/features/console/ConsoleScreen').then((m) => ({ default: m.ConsoleScreen })))

/**
 * /shell — pick a node shell (phones open it full screen; desktop embeds the
 * selected node's shell here) and jump to the console of a running guest.
 */
export function ShellPage() {
  const desktop = useIsDesktop()
  const [search, setSearch] = useSearchParams()
  const { data, isPending } = useClusterResources()
  const { nodes, guests } = useMemo(() => {
    const all = data ?? []
    return {
      nodes: all.filter(isNode).sort((a, b) => a.node.localeCompare(b.node)),
      guests: all.filter(isGuest).filter((g) => g.status === 'running' && g.template !== 1).sort(byVmid),
    }
  }, [data])
  const online = nodes.filter((n) => n.status === 'online')
  const selected = online.find((n) => n.node === search.get('node')) ?? online[0]

  return (
    <>
      <PageHeader title="Shell" description="节点终端与客户机控制台" />

      {isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : nodes.length === 0 ? (
        <GlassCard>
          <EmptyState icon={Server} title="没有可用的节点" description="当前账号看不到任何节点。" />
        </GlassCard>
      ) : (
        <div className="grid gap-(--section-gap)">
          <section>
            <SectionHeader title="节点 Shell" />
            {desktop ? (
              <div className="grid gap-3">
                {nodes.length > 1 && (
                  <div role="radiogroup" aria-label="选择节点" className="flex flex-wrap gap-2">
                    {nodes.map((n) => {
                      const active = n.node === selected?.node
                      return (
                        <button
                          key={n.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={n.status !== 'online'}
                          onClick={() => setSearch({ node: n.node }, { replace: true })}
                          className={cn(
                            'inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors disabled:opacity-50',
                            active
                              ? 'border-primary/50 bg-primary/10 text-foreground'
                              : 'border-border bg-(--field) text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <StatusDot status={n.status} size="sm" pulse={false} decorative />
                          {n.node}
                        </button>
                      )
                    })}
                  </div>
                )}
                {selected ? (
                  <Suspense fallback={<Skeleton className="h-[min(70dvh,48rem)] rounded-2xl" />}>
                    <ConsoleScreen
                      key={selected.node}
                      target={{ kind: 'node', node: selected.node }}
                      variant="embedded"
                      title={selected.node}
                    />
                  </Suspense>
                ) : (
                  <GlassCard>
                    <EmptyState icon={Server} title="所有节点都离线" description="节点上线后才能打开 Shell。" />
                  </GlassCard>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {nodes.map((n) => (
                  <NodeShellCard key={n.id} node={n} />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHeader title="运行中的客户机" />
            {guests.length === 0 ? (
              <GlassCard>
                <EmptyState icon={SquareTerminal} title="没有运行中的客户机" description="启动虚拟机或容器后，可以在这里直接打开它的控制台。" />
              </GlassCard>
            ) : (
              <GlassCard flush className="overflow-hidden">
                <ul className="divide-y divide-border/60">
                  {guests.map((g) => (
                    <GuestConsoleRow key={g.id} guest={g} />
                  ))}
                </ul>
              </GlassCard>
            )}
          </section>
        </div>
      )}
    </>
  )
}

function NodeShellCard({ node: n }: { node: NodeResource }) {
  const online = n.status === 'online'
  return (
    <GlassCard className="grid gap-4">
      <div className="flex items-center gap-3">
        <ResourceIcon type="node" variant="tile" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">{n.node}</span>
            <StatusDot status={n.status} size="sm" />
          </div>
          <div className="truncate text-xs text-muted-foreground tabular">
            {online
              ? <><span className={METRIC_TEXT[usageTone(n.cpu)]}>CPU {formatPercent(n.cpu)}</span> · <span className={METRIC_TEXT[usageTone(ratio(n.mem, n.maxmem))]}>内存 {formatPercent(ratio(n.mem, n.maxmem))}</span> · 运行 {formatUptime(n.uptime)}</>
              : statusLabel(n.status)}
          </div>
        </div>
      </div>
      {online ? (
        <Button asChild size="lg" className="w-full">
          <Link to={nodeShellPath(n.node)}>
            <SquareTerminal /> 打开 Shell
          </Link>
        </Button>
      ) : (
        <Button size="lg" className="w-full" disabled>
          节点离线
        </Button>
      )}
    </GlassCard>
  )
}

function GuestConsoleRow({ guest: g }: { guest: GuestResource }) {
  return (
    <li>
      <Link
        to={consolePath(g)}
        className="flex min-h-14 items-center gap-3 px-(--card-p) py-(--row-py) transition-colors hover:bg-accent/60 active:bg-accent"
      >
        <ResourceIcon type={g.type} variant="tile" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{guestName(g)}</div>
          <div className="truncate text-xs text-muted-foreground tabular">
            {GUEST_TYPE_LABEL[g.type]} {g.vmid} · {g.node}
          </div>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">{g.type === 'qemu' ? 'noVNC' : 'xterm.js'}</span>
        <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
      </Link>
    </li>
  )
}
