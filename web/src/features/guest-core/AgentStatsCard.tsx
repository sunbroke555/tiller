import { useMemo, useState, type ReactNode } from 'react'
import { Gauge } from 'lucide-react'

import { useAgentCpuStats, useAgentDisks, useAgentDiskStats, useAgentLoad, type AgentSample } from '@/api/guest-core'
import { useAptVersions } from '@/api/node-summary'
import { usePveFeature } from '@/api/pve-features'
import { GlassCard } from '@/components/GlassCard'
import { formatPercent, formatRate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { cpuBreakdown, diskRates, guestDiskRows, parseLoad, sampleGap, type CpuBreakdown, type DiskRate, type GuestDiskRow, type LoadAverages } from './agentStats'
import { CardTitle } from './parts'

interface AgentStatsCardProps {
  node: string
  vmid: number
  /** Running QEMU VM whose guest agent answers. */
  active: boolean
}

/**
 * Statistics read inside the guest through the QEMU guest agent: load
 * averages, CPU time split, per-disk IO and the disk inventory. Needs
 * qemu-server ≥ 9.2.14 and (in practice) a Linux guest. Each block hides
 * itself when its command fails, and the card disappears when none works.
 */
export function AgentStatsCard({ node, vmid, active }: AgentStatsCardProps) {
  const support = usePveFeature('guestAgentStats', node)
  // Same cached query usePveFeature reads: wait for the version before the
  // first call, so old PVE is not asked at all. Without permission it fails
  // and the calls are tried anyway (501 just hides the blocks).
  const apt = useAptVersions(node, { retry: false })
  const enabled = active && support !== 'unsupported' && !apt.isPending
  const load = useAgentLoad(node, vmid, { enabled })
  const cpu = useAgentCpuStats(node, vmid, { enabled })
  const diskStats = useAgentDiskStats(node, vmid, { enabled })
  const disks = useAgentDisks(node, vmid, { enabled })

  const cpuPair = useSamplePair(enabled && cpu.isSuccess ? cpu.data : undefined)
  const diskPair = useSamplePair(enabled && diskStats.isSuccess ? diskStats.data : undefined)

  const loadAvg = enabled && load.isSuccess ? parseLoad(load.data) : null
  const cpuData = cpuPair.cur?.data
  const diskData = diskPair.cur?.data
  const cpuWorks = Array.isArray(cpuData) && cpuData.length > 0
  const diskIoWorks = Array.isArray(diskData) && diskData.length > 0
  const breakdown = useMemo(() => {
    const gap = sampleGap(cpuPair.prev, cpuPair.cur)
    return gap === null ? null : cpuBreakdown(cpuPair.prev?.data, cpuPair.cur?.data)
  }, [cpuPair])
  const rates = useMemo(() => {
    const gap = sampleGap(diskPair.prev, diskPair.cur)
    return gap === null ? null : diskRates(diskPair.prev?.data, diskPair.cur?.data, gap)
  }, [diskPair])
  const diskRows = useMemo(() => (enabled && disks.isSuccess ? guestDiskRows(disks.data) : []), [enabled, disks.isSuccess, disks.data])

  if (!loadAvg && !cpuWorks && !diskIoWorks && diskRows.length === 0) return null

  const left = (loadAvg || cpuWorks) && (
    <div className="grid content-start gap-5">
      {loadAvg && <LoadBlock load={loadAvg} />}
      {cpuWorks && <CpuBlock breakdown={breakdown} />}
    </div>
  )
  const right = (diskIoWorks || diskRows.length > 0) && (
    <div className="grid content-start gap-5">
      {diskIoWorks && <DiskIoBlock rates={rates} />}
      {diskRows.length > 0 && <DiskListBlock rows={diskRows} />}
    </div>
  )

  return (
    <GlassCard className="@container" role="region" aria-label="系统内统计">
      <CardTitle
        title="系统内统计"
        icon={Gauge}
        action={<span className="text-xs text-muted-foreground">来自 Guest Agent</span>}
      />
      <div className={cn('grid gap-5 border-t border-border/60 pt-4', left && right && '@[40rem]:grid-cols-2 @[40rem]:gap-8')}>
        {left}
        {right}
      </div>
    </GlassCard>
  )
}

/** Keeps the previous and current sample so counters can be compared. */
function useSamplePair<T>(sample: AgentSample<T> | undefined) {
  const [pair, setPair] = useState<{ prev?: AgentSample<T>; cur?: AgentSample<T> }>({})
  if (sample !== pair.cur) setPair({ prev: sample ? pair.cur : undefined, cur: sample })
  return pair
}

function BlockTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
      {hint && <span className="text-[11px] text-muted-foreground tabular">{hint}</span>}
    </div>
  )
}

function Waiting() {
  return <p className="text-xs text-muted-foreground">正在采样，稍后显示…</p>
}

function formatLoad(v: number | undefined) {
  return v === undefined ? '—' : v.toFixed(2)
}

function LoadBlock({ load }: { load: LoadAverages }) {
  const items: [string, number | undefined][] = [
    ['1 分钟', load.load1],
    ['5 分钟', load.load5],
    ['15 分钟', load.load15],
  ]
  return (
    <section>
      <BlockTitle>平均负载</BlockTitle>
      <dl className="grid grid-cols-3 gap-2">
        {items.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-border/60 ring-inset paper:bg-secondary/50">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-lg leading-tight font-medium tabular">{formatLoad(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const CPU_PARTS: { key: keyof Pick<CpuBreakdown, 'user' | 'system' | 'iowait' | 'steal'>; label: string; color: string }[] = [
  { key: 'user', label: '用户', color: 'bg-chart-1' },
  { key: 'system', label: '系统', color: 'bg-chart-2' },
  { key: 'iowait', label: 'IO 等待', color: 'bg-chart-4' },
  { key: 'steal', label: '被抢占', color: 'bg-chart-5' },
]

function CpuBlock({ breakdown }: { breakdown: CpuBreakdown | null }) {
  return (
    <section>
      <BlockTitle hint={breakdown ? `使用率 ${formatPercent(breakdown.busy)}` : undefined}>CPU 时间分布</BlockTitle>
      {!breakdown ? (
        <Waiting />
      ) : (
        <>
          <div
            className="flex h-2 w-full overflow-hidden rounded-full bg-foreground/[0.06] paper:bg-secondary"
            role="img"
            aria-label={CPU_PARTS.map((p) => `${p.label} ${formatPercent(breakdown[p.key])}`).join('，')}
          >
            {CPU_PARTS.map((p) => (
              <div key={p.key} className={cn('h-full', p.color)} style={{ width: `${Math.min(breakdown[p.key], 1) * 100}%` }} />
            ))}
          </div>
          <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs @[24rem]:grid-cols-4">
            {CPU_PARTS.map((p) => (
              <div key={p.key} className="flex min-w-0 items-center gap-1.5">
                <span className={cn('size-2 shrink-0 rounded-full', p.color)} aria-hidden />
                <dt className="text-muted-foreground">{p.label}</dt>
                <dd className="ml-auto tabular @[24rem]:ml-1">{formatPercent(breakdown[p.key])}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}

function formatIops(v: number | null) {
  if (v === null) return '—'
  return v !== 0 && v < 10 ? v.toFixed(1) : Math.round(v).toString()
}

function DiskIoBlock({ rates }: { rates: DiskRate[] | null }) {
  return (
    <section>
      <BlockTitle>磁盘 IO</BlockTitle>
      {rates === null ? (
        <Waiting />
      ) : rates.length === 0 ? (
        <p className="text-xs text-muted-foreground">没有可显示的磁盘活动。</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rates.map((r) => (
            <li key={r.name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 first:pt-0 last:pb-0">
              <span className="font-mono text-[13px] font-medium">{r.name}</span>
              <span className="ml-auto text-right text-xs tabular">
                读 {formatRate(r.readBps)} · 写 {formatRate(r.writeBps)}
                <span className="block text-[11px] text-muted-foreground">
                  IOPS 读 {formatIops(r.readIops)} · 写 {formatIops(r.writeIops)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function DiskListBlock({ rows }: { rows: GuestDiskRow[] }) {
  return (
    <section>
      <BlockTitle hint={`${rows.length} 个设备`}>系统内磁盘</BlockTitle>
      <ul className="divide-y divide-border/60">
        {rows.map((r) => {
          const details = [r.bus?.toUpperCase(), r.serial && `序列号 ${r.serial}`, r.temperature !== undefined && `${r.temperature} °C`].filter(Boolean)
          return (
            <li key={r.name} className={cn('flex min-w-0 flex-col gap-0.5 py-2 first:pt-0 last:pb-0', r.depth === 1 && 'pl-4', r.depth >= 2 && 'pl-8')}>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[13px] font-medium [overflow-wrap:anywhere]">{r.name}</span>
                {r.partition && (
                  <span className="rounded-md bg-foreground/[0.06] px-1.5 py-px text-[11px] text-muted-foreground paper:bg-secondary">分区</span>
                )}
                {r.alias && <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{r.alias}</span>}
              </div>
              {details.length > 0 && (
                <span className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{details.join(' · ')}</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
