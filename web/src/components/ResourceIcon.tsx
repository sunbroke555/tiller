import { Box, Database, Folder, LayoutTemplate, Monitor, Network, Server, type LucideIcon } from 'lucide-react'

import type { ResourceType } from '@/api/types'
import { cn } from '@/lib/utils'

const ICONS: Record<ResourceType, LucideIcon> = {
  node: Server,
  qemu: Monitor,
  lxc: Box,
  storage: Database,
  pool: Folder,
  sdn: Network,
  network: Network,
  openvz: Box,
}

const LABELS: Record<ResourceType, string> = {
  node: '节点',
  qemu: '虚拟机',
  lxc: '容器',
  storage: '存储',
  pool: '资源池',
  sdn: 'SDN',
  network: '网络',
  openvz: 'OpenVZ',
}

interface ResourceIconProps {
  type: ResourceType
  template?: boolean
  /** "tile" draws a tinted rounded square behind the icon. */
  variant?: 'plain' | 'tile'
  className?: string
}

export function ResourceIcon({ type, template, variant = 'plain', className }: ResourceIconProps) {
  const Icon = template ? LayoutTemplate : ICONS[type]
  const label = template ? `${LABELS[type]}模板` : LABELS[type]
  if (variant === 'plain') {
    return <Icon aria-label={label} role="img" className={cn('size-4 shrink-0 text-muted-foreground', className)} />
  }
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-xl',
        'bg-brand/10 text-brand-strong ring-1 ring-brand/15 ring-inset',
        'paper:bg-secondary paper:text-foreground/80 paper:ring-border',
        className,
      )}
    >
      <Icon aria-hidden className="size-[18px]" />
    </span>
  )
}
