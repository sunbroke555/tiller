import { Copy, Cpu, LayoutTemplate } from 'lucide-react'

import type { GuestConfig } from '@/api/guest-core'
import type { GuestType } from '@/api/types'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes } from '@/lib/format'
import { isCdrom, parseQemuNet, tryParsePropertyString } from '@/lib/propstring'
import { parsePveSize } from '@/lib/size'

import { osTypeLabel } from './labels'
import { CardTitle, InfoList, InfoRow } from './parts'

/** Hero card of a template: what it is, and the clone entry point. */
export function TemplateHero({ type, onClone }: { type: GuestType; onClone?: () => void }) {
  return (
    <GlassCard className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/70 paper:ring-border">
        <LayoutTemplate className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-medium text-foreground">{type === 'qemu' ? '虚拟机模板' : '容器模板'}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          模板不能启动，用来快速克隆出新的{type === 'qemu' ? '虚拟机' : '容器'}。链接克隆几乎不占空间，完整克隆互不依赖。
        </p>
      </div>
      {onClone && (
        <Button type="button" onClick={onClone} className="h-11 shrink-0 sm:h-9">
          <Copy /> 克隆
        </Button>
      )}
    </GlassCard>
  )
}

const DISK_KEY = /^(scsi|sata|ide|virtio|efidisk|tpmstate)\d+$/

export interface ConfigDisk {
  key: string
  volume: string
  size?: string
}

/** Disks of a config (QEMU drives without CD-ROMs, LXC rootfs and mount points). */
export function configDisks(config: GuestConfig, type: GuestType): ConfigDisk[] {
  const out: ConfigDisk[] = []
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string') continue
    if (type === 'qemu' && DISK_KEY.test(key)) {
      const d = tryParsePropertyString(value, 'file')
      if (isCdrom(d)) continue
      out.push({ key, volume: d.file ?? value, size: d.size })
    } else if (type === 'lxc' && (key === 'rootfs' || /^mp\d+$/.test(key))) {
      const m = tryParsePropertyString(value, 'volume')
      out.push({ key, volume: m.volume ?? value, size: m.size })
    }
  }
  return out.sort((a, b) => (a.key === 'rootfs' ? -1 : b.key === 'rootfs' ? 1 : a.key.localeCompare(b.key, undefined, { numeric: true })))
}

function sizeText(size: string | undefined): string | undefined {
  if (!size) return undefined
  const bytes = parsePveSize(size)
  return bytes !== null && bytes !== undefined ? formatBytes(bytes) : size
}

/** Config at a glance (templates have no live data to show). */
export function ConfigSummary({ type, config, loading }: { type: GuestType; config: GuestConfig | undefined; loading: boolean }) {
  if (loading && !config) {
    return (
      <GlassCard>
        <div className="grid gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      </GlassCard>
    )
  }
  if (!config) return null
  const cores = Number(config.cores ?? 1) * Number(config.sockets ?? 1)
  const memory = Number(String(config.memory ?? '').replace(/^current=/, '').split(',')[0]) || (type === 'lxc' ? 512 : 2048)
  const disks = configDisks(config, type)
  const nets = Object.keys(config)
    .filter((k) => /^net\d+$/.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return (
    <GlassCard>
      <CardTitle title="配置" icon={Cpu} />
      <InfoList>
        <InfoRow label="处理器">
          {cores} 核
          {Number(config.sockets ?? 1) > 1 && <span className="text-muted-foreground"> （{config.sockets} 插槽）</span>}
        </InfoRow>
        <InfoRow label="内存">{formatBytes(memory * 1024 * 1024)}</InfoRow>
        {type === 'lxc' && config.swap !== undefined && <InfoRow label="交换">{formatBytes(Number(config.swap) * 1024 * 1024)}</InfoRow>}
        {config.ostype && <InfoRow label="系统类型">{osTypeLabel(config.ostype)}</InfoRow>}
        {disks.map((d) => (
          <InfoRow key={d.key} label={d.key === 'rootfs' ? '根磁盘' : d.key} mono>
            <span className="block truncate">{d.volume}</span>
            {d.size && <span className="block text-xs text-muted-foreground">{sizeText(d.size)}</span>}
          </InfoRow>
        ))}
        {nets.map((k) => {
          const raw = String(config[k])
          const q = type === 'qemu' ? parseQemuNet(raw) : null
          const l = type === 'lxc' ? tryParsePropertyString(raw) : null
          const bridge = q?.options.bridge ?? l?.bridge
          return (
            <InfoRow key={k} label={k} mono>
              {q ? `${q.model}${bridge ? ` · ${bridge}` : ''}` : `${l?.name ?? ''}${bridge ? ` · ${bridge}` : ''}`}
            </InfoRow>
          )
        })}
      </InfoList>
    </GlassCard>
  )
}
