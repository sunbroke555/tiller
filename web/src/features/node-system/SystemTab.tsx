import { useEffect, useState } from 'react'
import {
  Clock,
  Gauge,
  Globe,
  Lock,
  MapPin,
  Pencil,
  Power,
  Search,
  Server,
  Timer,
  type LucideIcon,
} from 'lucide-react'

import { useNodeDns, useNodeHosts, useNodeOptions, useNodeTime, type NodeTimeSample } from '@/api/node-system'
import { usePermissions } from '@/api/permissions'
import { ErrorState } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { NodeTabProps } from '@/features/node/types'
import { cn } from '@/lib/utils'

import { DnsDialog, HostsDialog, LocationDialog, NumberOptionDialog, TimezoneDialog, WakeOnLanDialog } from './dialogs'
import {
  BALLOON_TARGET_DEFAULT,
  checkHosts,
  clockSkew,
  formatClock,
  formatUtcOffset,
  parseLocation,
  parseWakeOnLan,
} from './model'
import { Row, Section, SectionState } from './ui'
import { HardwareSettings } from '@/features/node-hardware/HardwareSettings'

type DialogId = 'dns' | 'hosts' | 'timezone' | 'delay' | 'balloon' | 'wol' | 'location'

/** /node/:node/system — DNS, time zone, node options and /etc/hosts. */
export default function SystemTab({ node }: NodeTabProps) {
  const canModify = usePermissions().can({ privs: 'Sys.Modify' }, { kind: 'node', node })
  const [dialog, setDialog] = useState<DialogId | null>(null)
  const edit = (id: DialogId) => () => setDialog(id)
  const dialogProps = (id: DialogId) => ({
    node,
    open: dialog === id,
    onOpenChange: (open: boolean) => setDialog(open ? id : null),
  })

  const dns = useNodeDns(node)
  const hosts = useNodeHosts(node)
  const time = useNodeTime(node)
  const config = useNodeOptions(node)

  return (
    <div className="grid gap-(--section-gap)">
      {!canModify && (
        <p role="note" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" aria-hidden />
          只读：修改这些设置需要节点的 Sys.Modify 权限。
        </p>
      )}
      <div className="grid min-w-0 items-stretch gap-4 xl:grid-cols-2">
        <Section id="node-time" title="时间">
          {time.data ? (
            <TimeRows sample={time.data} onEdit={canModify ? edit('timezone') : undefined} />
          ) : (
            <SectionState query={time} title="无法读取时间" />
          )}
        </Section>

        <Section
          id="node-dns"
          title="DNS"
          action={canModify && dns.data && <EditButton label="编辑 DNS" onClick={edit('dns')} />}
        >
          {dns.data ? (
            <>
              <Row
                icon={Search}
                label="搜索域"
                value={dns.data.search || '未设置'}
                muted={!dns.data.search}
                onEdit={canModify ? edit('dns') : undefined}
              />
              {(['dns1', 'dns2', 'dns3'] as const).map((k, i) =>
                dns.data[k] || i === 0 ? (
                  <Row
                    key={k}
                    icon={Server}
                    label={`DNS 服务器 ${i + 1}`}
                    value={<span className="tabular">{dns.data[k] || '未设置'}</span>}
                    muted={!dns.data[k]}
                    onEdit={canModify ? edit('dns') : undefined}
                  />
                ) : null,
              )}
            </>
          ) : (
            <SectionState query={dns} rows={3} title="无法读取 DNS 设置" />
          )}
        </Section>
        <Section id="node-options" title="节点选项">
          {config.data ? (
            <OptionRows config={config.data} edit={canModify ? edit : undefined} />
          ) : (
            <SectionState query={config} rows={4} title="无法读取节点选项" />
          )}
        </Section>

        <HostsSection node={node} hosts={hosts} onEdit={canModify ? edit('hosts') : undefined} />
      </div>

      <HardwareSettings node={node} />
      <DnsDialog {...dialogProps('dns')} dns={dns.data} />
      <TimezoneDialog {...dialogProps('timezone')} timezone={time.data?.timezone} />
      <HostsDialog {...dialogProps('hosts')} hosts={hosts.data} />
      <NumberOptionDialog {...dialogProps('delay')} config={config.data} option="startall-onboot-delay" />
      <NumberOptionDialog {...dialogProps('balloon')} config={config.data} option="ballooning-target" />
      <WakeOnLanDialog {...dialogProps('wol')} config={config.data} />
      <LocationDialog {...dialogProps('location')} config={config.data} />
    </div>
  )
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} aria-label={label} className="pointer-coarse:h-10">
      <Pencil /> 编辑
    </Button>
  )
}

// ------------------------------------------------------------------- time

/** Re-render every second while mounted. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function TimeRows({ sample, onEdit }: { sample: NodeTimeSample; onEdit?: () => void }) {
  const now = useNow()
  const elapsed = Math.max(0, (now - sample.fetchedAt) / 1000)
  const offset = sample.localtime - sample.time
  const skew = clockSkew(sample.time, sample.fetchedAt)
  return (
    <>
      <Row
        icon={Globe}
        label="时区"
        value={
          <>
            {sample.timezone} <span className="text-faint">· {formatUtcOffset(offset)}</span>
          </>
        }
        onEdit={onEdit}
      />
      <Row
        icon={Clock}
        label="节点时间"
        value={
          <span aria-live="off" className="block">
            <span className="block font-mono text-[13px] text-foreground tabular" data-testid="node-localtime">
              {formatClock(sample.localtime + elapsed)}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground tabular">UTC {formatClock(sample.time + elapsed)}</span>
          </span>
        }
        detail={
          skew !== null && (
            <span className="block text-warning-strong">
              比本设备时钟{skew > 0 ? '快' : '慢'} {Math.abs(skew)} 秒，请检查节点的时间同步（chrony）。
            </span>
          )
        }
      />
    </>
  )
}

// ---------------------------------------------------------- node options

function OptionRows({
  config,
  edit,
}: {
  config: NonNullable<ReturnType<typeof useNodeOptions>['data']>
  edit?: (id: DialogId) => () => void
}) {
  const delay = config['startall-onboot-delay']
  const balloon = config['ballooning-target']
  const wol = parseWakeOnLan(config.wakeonlan)
  const loc = parseLocation(config.location)
  const hasLoc = loc.latitude !== undefined && loc.longitude !== undefined
  const rows: { id: DialogId; icon: LucideIcon; label: string; value: string; detail?: string; muted: boolean }[] = [
    {
      id: 'delay',
      icon: Timer,
      label: '开机启动延迟',
      value: delay !== undefined ? `${delay} 秒` : '默认（0 秒）',
      detail: '节点开机后等待多久再启动“开机自启”的客户机',
      muted: delay === undefined,
    },
    {
      id: 'wol',
      icon: Power,
      label: 'Wake-on-LAN',
      value: wol.mac || (config.wakeonlan ?? '未设置'),
      detail: wol.mac
        ? [wol.bindInterface && `接口 ${wol.bindInterface}`, wol.broadcast && `广播 ${wol.broadcast}`].filter(Boolean).join(' · ') ||
          undefined
        : undefined,
      muted: !config.wakeonlan,
    },
    {
      id: 'balloon',
      icon: Gauge,
      label: 'Ballooning 目标',
      value: balloon !== undefined ? `${balloon}%` : `默认（${BALLOON_TARGET_DEFAULT}%）`,
      detail: '节点内存使用率超过它时回收虚拟机的 balloon 内存',
      muted: balloon === undefined,
    },
    {
      id: 'location',
      icon: MapPin,
      label: '位置',
      value: hasLoc
        ? `${loc.name ? `${loc.name} · ` : ''}${loc.latitude}°, ${loc.longitude}°`
        : '使用数据中心设置',
      muted: !hasLoc,
    },
  ]
  return (
    <>
      {rows.map((r) => (
        <Row
          key={r.id}
          icon={r.icon}
          label={r.label}
          value={<span className={cn(r.id === 'wol' && wol.mac && 'font-mono')}>{r.value}</span>}
          detail={r.detail}
          muted={r.muted}
          onEdit={edit?.(r.id)}
        />
      ))}
    </>
  )
}

// ------------------------------------------------------------------ hosts

function HostsSection({
  node,
  hosts,
  onEdit,
}: {
  node: string
  hosts: ReturnType<typeof useNodeHosts>
  onEdit?: () => void
}) {
  const text = hosts.data?.data ?? ''
  const check = hosts.data ? checkHosts(text, node) : null
  const lines = text.replace(/\n$/, '').split('\n')
  return (
    <Section
      id="node-hosts"
      title="Hosts"
      description={<span className="font-mono">/etc/hosts<span className="font-sans">{check ? ` · ${check.entries.length} 条记录` : ''}</span></span>}
      action={onEdit && hosts.data && <EditButton label="编辑 Hosts" onClick={onEdit} />}
    >
      {hosts.isPending ? (
        <div className="grid gap-2 p-(--card-p)" aria-busy="true" aria-label="加载中">
          {[70, 55, 80, 40].map((w) => (
            <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : hosts.isError && !hosts.data ? (
        <ErrorState compact title="无法读取 /etc/hosts" error={hosts.error} onRetry={() => void hosts.refetch()} />
      ) : (
        <>
          {check?.missingNode && (
            <p role="alert" className="border-b border-border/70 bg-destructive/10 px-(--card-p) py-2.5 text-sm text-destructive">
              没有指向本节点 {node} 的条目，集群通信可能受影响。
            </p>
          )}
          <pre
            aria-label="hosts 文件内容"
            tabIndex={0}
            className="max-h-80 overflow-auto overscroll-contain py-3 font-mono text-xs leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {lines.map((line, i) => (
              <div key={i} className={cn('flex min-h-6 w-max min-w-full pr-(--card-p)', /^\s*#/.test(line) && 'text-muted-foreground')}>
                  <span aria-hidden className="mr-3 w-10 shrink-0 pr-2 text-right text-faint select-none">{i + 1}</span>
                <span className="whitespace-pre">{line}</span>
              </div>
            ))}
          </pre>
        </>
      )}
    </Section>
  )
}
