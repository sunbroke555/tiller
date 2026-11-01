// Ceph status dashboard: health with its checks, usage and I/O, recovery,
// PG states, OSD up/in matrix and the monitor / manager / MDS overview
// (official PVE.node.CephStatus + PVE.ceph.StatusDetail + PVE.ceph.Services).

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ChevronDown, ClipboardCopy, VolumeX } from 'lucide-react'
import { toast } from 'sonner'

import type { CephMetadata, CephStatus } from '@/api/ceph'
import { Sparkline } from '@/components/Sparkline'
import { UsageBar } from '@/components/UsageBar'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatBytes, formatDuration, formatRate, formatUsage, ratio } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  HEALTH_LABEL,
  PG_CATEGORY_LABEL,
  buildServices,
  compareCephVersions,
  healthCheckText,
  healthChecks,
  healthTone,
  newestNodeVersion,
  osdCounts,
  parseCephVersion,
  pgSummary,
  recoveryInfo,
  SERVICE_LABEL,
  type HealthCheckRow,
  type PgCategory,
  type ServiceRow,
  type ServiceType,
} from './model'
import { Chip, Section, ToneDot, ToneIcon, TONE_TEXT, type Tone } from './ui'

const PG_TONE: Record<PgCategory, Tone> = { unknown: 'unknown', clean: 'ok', busy: 'info', warning: 'warn', critical: 'err' }

const PG_BAR: Record<PgCategory, string> = {
  unknown: 'bg-muted-foreground/40',
  clean: 'bg-success',
  busy: 'bg-brand',
  warning: 'bg-warning',
  critical: 'bg-destructive',
}

export function StatusView({ status, metadata, base }: { status: CephStatus; metadata: CephMetadata | undefined; base: string }) {
  return (
    <div className="grid min-w-0 gap-(--section-gap) xl:grid-cols-2">
      <HealthCard status={status} metadata={metadata} />
      <UsageCard status={status} />
      <PgCard status={status} />
      <OsdCard status={status} metadata={metadata} base={base} />
      <ServicesCard status={status} metadata={metadata} base={base} className="xl:col-span-2" />
    </div>
  )
}

// ------------------------------------------------------------------ health

function HealthCard({ status, metadata }: { status: CephStatus; metadata: CephMetadata | undefined }) {
  const tone = healthTone(status.health?.status)
  const checks = useMemo(() => healthChecks(status.health), [status.health])
  const version = newestNodeVersion(metadata)
  return (
    <Section title="健康" count={checks.length || undefined} data-testid="ceph-health">
      <div className="flex items-center gap-3">
        <ToneIcon tone={tone} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className={cn('text-lg font-semibold', TONE_TEXT[tone])} data-testid="ceph-health-status">
            {HEALTH_LABEL[tone]}
            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{status.health?.status ?? 'HEALTH_UNKNOWN'}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {version ? `Ceph ${version}` : 'Ceph'}
            {status.fsid && <span className="ml-2 hidden font-mono sm:inline">{status.fsid}</span>}
          </div>
        </div>
      </div>
      {checks.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">没有警告或错误。</p>
      ) : (
        <ul className="mt-3 grid gap-1.5" aria-label="健康检查">
          {checks.map((c) => (
            <HealthCheckItem key={c.id} check={c} />
          ))}
        </ul>
      )}
    </Section>
  )
}

function HealthCheckItem({ check }: { check: HealthCheckRow }) {
  const [open, setOpen] = useState(false)
  const copy = () => {
    navigator.clipboard
      .writeText(healthCheckText(check))
      .then(() => toast.success('已复制'))
      .catch(() => toast.error('无法复制到剪贴板'))
  }
  return (
    <li className="rounded-xl bg-foreground/[0.03] ring-1 ring-border/60 ring-inset paper:bg-secondary/40" data-check={check.id}>
      <div className="flex items-start gap-1">
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ToneIcon tone={check.tone} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="break-words">{check.summary}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              {check.id}
              {check.muted && (
                <Chip tone="unknown">
                  <VolumeX className="size-3" aria-hidden />
                  已静默
                </Chip>
              )}
            </span>
          </span>
          <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
        <Button variant="ghost" size="icon" className="mt-1 mr-1 shrink-0 pointer-coarse:size-10" onClick={copy} aria-label={`复制 ${check.id}`} title="复制">
          <ClipboardCopy />
        </Button>
      </div>
      {open && (
        <pre className="mx-3 mb-3 max-h-60 overflow-auto rounded-lg bg-background/60 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground paper:bg-card">
          {check.detail.length ? check.detail.join('\n') : '没有更多信息'}
        </pre>
      )}
    </li>
  )
}

// ------------------------------------------------------------------- usage

const HISTORY = 40

/** Last samples of a value, appended whenever the status changes. */
function useHistory(value: number | undefined, tick: unknown): number[] {
  const [history, setHistory] = useState<number[]>([])
  const last = useRef<unknown>(undefined)
  useEffect(() => {
    if (tick === last.current) return
    last.current = tick
    setHistory((h) => [...h.slice(-(HISTORY - 1)), value ?? 0])
  }, [value, tick])
  return history
}

function UsageCard({ status }: { status: CephStatus }) {
  const pg = status.pgmap ?? {}
  const used = pg.bytes_used ?? 0
  const total = pg.bytes_total ?? 0
  const recovery = recoveryInfo(status.pgmap)
  const reads = useHistory(pg.read_bytes_sec, status.pgmap)
  const writes = useHistory(pg.write_bytes_sec, status.pgmap)
  const readOps = useHistory(pg.read_op_per_sec, status.pgmap)
  const writeOps = useHistory(pg.write_op_per_sec, status.pgmap)
  return (
    <Section title="容量与性能" data-testid="ceph-usage">
      <UsageBar value={ratio(used, total)} label="已用" detail={formatUsage(used, total)} />
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="存储池" value={pg.num_pools ?? 0} />
        <Stat label="对象" value={(pg.num_objects ?? 0).toLocaleString()} />
        <Stat label="数据" value={formatBytes(pg.data_bytes ?? 0)} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <IoTile label="读取" value={formatRate(pg.read_bytes_sec ?? 0)} history={reads} />
        <IoTile label="写入" value={formatRate(pg.write_bytes_sec ?? 0)} history={writes} />
        <IoTile label="读 IOPS" value={(pg.read_op_per_sec ?? 0).toLocaleString()} history={readOps} />
        <IoTile label="写 IOPS" value={(pg.write_op_per_sec ?? 0).toLocaleString()} history={writeOps} />
      </div>
      {recovery && (
        <div className="mt-4 grid gap-1.5" data-testid="ceph-recovery">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">恢复 / 再平衡</span>
            <span className="text-muted-foreground tabular">
              {(recovery.ratio * 100).toFixed(1)}%
              {recovery.speed > 0 && ` · ${formatRate(recovery.speed)}`}
              {recovery.eta != null && ` · 剩余约 ${formatDuration(recovery.eta)}`}
            </span>
          </div>
          <Progress value={recovery.ratio * 100} aria-label="恢复进度" />
        </div>
      )}
      {Object.values(status.progress_events ?? {}).map((e) => (
        <div key={e.message} className="mt-3 grid gap-1">
          <div className="truncate text-xs text-muted-foreground">{e.message}</div>
          <Progress value={(e.progress ?? 0) * 100} aria-label={e.message} />
        </div>
      ))}
    </Section>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-foreground/[0.03] px-2 py-2 ring-1 ring-border/60 ring-inset paper:bg-secondary/40">
      <div className="text-sm font-medium tabular">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

function IoTile({ label, value, history }: { label: string; value: string; history: number[] }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="truncate font-medium tabular">{value}</span>
      </div>
      <Sparkline values={history} className="mt-1 h-7" aria-label={`${label}趋势`} />
    </div>
  )
}

// --------------------------------------------------------------------- PGs

function PgCard({ status }: { status: CephStatus }) {
  const pg = useMemo(() => pgSummary(status.pgmap?.pgs_by_state), [status.pgmap?.pgs_by_state])
  return (
    <Section title="归置组（PG）" count={pg.total} data-testid="ceph-pgs">
      {pg.total === 0 ? (
        <p className="text-sm text-muted-foreground">还没有 PG：创建存储池后出现。</p>
      ) : (
        <>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary" role="img" aria-label="PG 状态分布">
            {pg.categories
              .filter((c) => c.count > 0)
              .map((c) => (
                <div key={c.category} className={PG_BAR[c.category]} style={{ width: `${(c.count / pg.total) * 100}%` }} />
              ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {pg.categories
              .filter((c) => c.count > 0)
              .map((c) => (
                <span key={c.category} className="inline-flex items-center gap-1.5">
                  <ToneDot tone={PG_TONE[c.category]} />
                  {PG_CATEGORY_LABEL[c.category]}
                  <span className="text-muted-foreground tabular">{c.count}</span>
                </span>
              ))}
          </div>
          <ul className="mt-3 grid gap-1 text-sm" aria-label="PG 状态">
            {pg.states.map((s) => (
              <li key={s.state_name} className="flex items-center gap-2" data-pg-state={s.state_name}>
                <ToneDot tone={PG_TONE[s.category]} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.state_name}</span>
                <span className="tabular">{s.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}

// -------------------------------------------------------------------- OSDs

function OsdCard({ status, metadata, base }: { status: CephStatus; metadata: CephMetadata | undefined; base: string }) {
  const c = osdCounts(status)
  const newest = newestNodeVersion(metadata)
  const outdated = (metadata?.osd ?? [])
    .map((o) => ({ id: o.id, version: parseCephVersion(o) }))
    .filter((o) => o.version && newest && compareCephVersions(o.version, newest) !== 0)
  const ghosts = (metadata?.osd ?? []).filter((o) => !parseCephVersion(o))
  return (
    <Section
      title="OSD"
      count={c.total}
      data-testid="ceph-osds"
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to={`${base}/osd`}>管理</Link>
        </Button>
      }
    >
      <table className="w-full text-sm" aria-label="OSD 状态">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="w-1/3 text-left font-normal" />
            <th className="font-normal">in</th>
            <th className="font-normal">out</th>
          </tr>
        </thead>
        <tbody className="tabular">
          <tr>
            <th scope="row" className="py-1 text-left font-normal">
              <span className="inline-flex items-center gap-1.5">
                <ToneDot tone="ok" /> up
              </span>
            </th>
            <td className="text-center">{c.upIn}</td>
            <td className={cn('text-center', c.upOut > 0 && 'text-warning-strong')}>{c.upOut}</td>
          </tr>
          <tr>
            <th scope="row" className="py-1 text-left font-normal">
              <span className="inline-flex items-center gap-1.5">
                <ToneDot tone="err" /> down
              </span>
            </th>
            <td className={cn('text-center', c.downIn > 0 && 'text-destructive')}>{c.downIn}</td>
            <td className={cn('text-center', c.downOut > 0 && 'text-warning-strong')}>{c.downOut}</td>
          </tr>
        </tbody>
      </table>
      {outdated.length > 0 && (
        <p className="mt-3 text-xs text-warning-strong">
          版本过旧：{outdated.map((o) => `osd.${o.id} (${o.version})`).join('、')}
        </p>
      )}
      {ghosts.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground" title="没有元数据的 OSD，可能是删除后的残留">
          无元数据：{ghosts.map((o) => `osd.${o.id}`).join('、')}
        </p>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------- services

const SERVICE_TONE: Record<ServiceRow['tone'], Tone> = { ok: 'ok', warn: 'warn', err: 'err', unknown: 'unknown', old: 'old' }

function ServicesCard({ status, metadata, base, className }: { status: CephStatus; metadata: CephMetadata | undefined; base: string; className?: string }) {
  const services = useMemo(() => buildServices(metadata, status), [metadata, status])
  return (
    <Section
      title="服务"
      className={className}
      data-testid="ceph-services"
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to={`${base}/services`}>管理</Link>
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        {(['mon', 'mgr', 'mds'] as ServiceType[]).map((type) => (
          <div key={type} className="min-w-0">
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
              {SERVICE_LABEL[type]} <span className="tabular">{services[type].length}</span>
            </h3>
            {services[type].length === 0 ? (
              <p className="text-sm text-muted-foreground">无</p>
            ) : (
              <ul className="grid gap-1">
                {services[type].map((s) => (
                  <li key={s.key} className="flex min-w-0 items-start gap-2 text-sm" data-service={`${type}.${s.name}`} title={s.messages.join('\n') || undefined}>
                    <ToneIcon tone={SERVICE_TONE[s.tone]} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.state}
                        {s.host && s.host !== s.name && ` · ${s.host}`}
                        {s.version && ` · ${s.version}`}
                      </span>
                      {s.messages.map((m) => (
                        <span key={m} className="block text-xs break-words text-warning-strong">
                          {m}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}
