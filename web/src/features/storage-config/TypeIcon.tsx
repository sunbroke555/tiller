import { Archive, CloudDownload, Database, Folder, HardDrive, Layers, Network, Server, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

const ICON: Record<string, LucideIcon> = {
  dir: Folder,
  btrfs: Folder,
  lvm: Layers,
  lvmthin: Layers,
  zfspool: Database,
  zfs: Database,
  nfs: Server,
  cifs: Server,
  glusterfs: Server,
  cephfs: Network,
  rbd: Network,
  iscsi: Network,
  iscsidirect: Network,
  pbs: Archive,
  esxi: CloudDownload,
}

/** Small tile with the icon of a storage type. */
export function TypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = ICON[type] ?? HardDrive
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-strong ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/70 paper:ring-border',
        className,
      )}
    >
      <Icon className="size-4.5" />
    </span>
  )
}
