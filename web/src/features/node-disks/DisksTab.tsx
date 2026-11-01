import { useSearchParams } from 'react-router'
import { Database, Folder, HardDrive, Layers, SquareDashed, type LucideIcon } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { NodeTabProps } from '@/features/node/types'

import { DiskListView } from './DiskListView'
import { DirectoryView, LvmThinView, LvmView, ZfsView } from './StorageViews'

type ViewId = 'disks' | 'lvm' | 'lvmthin' | 'directory' | 'zfs'

const VIEWS: readonly { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: 'disks', label: '磁盘', icon: HardDrive },
  { id: 'lvm', label: 'LVM', icon: Layers },
  { id: 'lvmthin', label: 'LVM-Thin', icon: SquareDashed },
  { id: 'directory', label: '目录', icon: Folder },
  { id: 'zfs', label: 'ZFS', icon: Database },
]

/**
 * Node → 磁盘: physical disks (SMART, GPT, wipe) and the LVM, LVM-Thin,
 * directory and ZFS storages on them. The sub-view is kept in ?view= so it
 * survives reloads and can be linked.
 */
export default function DisksTab({ node }: NodeTabProps) {
  const [params, setParams] = useSearchParams()
  const view: ViewId = VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'disks'
  const select = (id: ViewId) => {
    const next = new URLSearchParams(params)
    if (id === 'disks') next.delete('view')
    else next.set('view', id)
    setParams(next, { replace: true })
  }

  return (
    <div className="grid gap-(--row-gap)">
      <div className="-mx-4 overflow-x-auto scrollbar-none px-4 sm:mx-0 sm:px-0">
        <ToggleGroup
          type="single"
          variant="outline"
          value={view}
          onValueChange={(v) => v && select(v as ViewId)}
          aria-label="磁盘视图"
          className="w-max min-w-full sm:min-w-0"
        >
          {VIEWS.map((v) => (
            <ToggleGroupItem key={v.id} value={v.id} className="h-10 flex-1 gap-1.5 px-3 text-xs sm:flex-none sm:text-sm pointer-coarse:h-11">
              <v.icon aria-hidden className="max-[400px]:hidden" />
              {v.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {view === 'disks' && <DiskListView node={node} />}
      {view === 'lvm' && <LvmView node={node} />}
      {view === 'lvmthin' && <LvmThinView node={node} />}
      {view === 'directory' && <DirectoryView node={node} />}
      {view === 'zfs' && <ZfsView node={node} />}
    </div>
  )
}
