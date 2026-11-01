import { ChevronRight } from 'lucide-react'

import { STORAGE_TYPES, type StorageType } from '@/api/storage-config'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'

import { STORAGE_TYPE_INFO, TYPE_GROUP_LABEL, type TypeGroup } from './model'
import { TypeIcon } from './TypeIcon'

const GROUPS: TypeGroup[] = ['local', 'network', 'backup']

/** "添加存储": pick the storage type, grouped local / network / backup. */
export function TypePickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (type: StorageType) => void
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} size="lg" title="添加存储" description="选择存储类型">
      <div className="grid gap-5 pb-2">
        {GROUPS.map((g) => (
          <section key={g} aria-label={TYPE_GROUP_LABEL[g]} className="grid gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">{TYPE_GROUP_LABEL[g]}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {STORAGE_TYPES.filter((t) => STORAGE_TYPE_INFO[t].group === g).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onPick(t)}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-accent paper:hover:border-primary/40"
                >
                  <TypeIcon type={t} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{STORAGE_TYPE_INFO[t].label}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{STORAGE_TYPE_INFO[t].description}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </ResponsiveDialog>
  )
}
