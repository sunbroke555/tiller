import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Archive, Loader2, Shield } from 'lucide-react'

import {
  fetchPrunePreview,
  pruneBackups,
  storageKeys,
  useStorageConfig,
  type PruneEntry,
  type StorageVolume,
} from '@/api/storage-browser'
import { EmptyState } from '@/components/EmptyState'
import { FormDialog, FormField, FormRow, NumberInput, SelectField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  backupGroups,
  parsePruneBackups,
  PRUNE_KEYS,
  PRUNE_LABEL,
  pruneKeepReasons,
  pruneParams,
  type BackupGroup,
  type PruneKeep,
} from './volumes'

export interface PruneDialogProps {
  node: string
  storage: string
  /** Backups on the storage (for the group picker). */
  backups: readonly StorageVolume[]
  /** Preselected group; none = all backups of the storage. */
  group?: { type: 'qemu' | 'lxc'; vmid: number }
  open: boolean
  onOpenChange: (open: boolean) => void
}

const groupKey = (g: { type: string; vmid: number }) => `${g.type}/${g.vmid}`

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Prune backups with keep-last/hourly/daily/… and a live dry run (GET
 * prunebackups) that marks what is kept and why, and what is removed.
 */
export function PruneDialog({ node, storage, backups, group, open, onOpenChange }: PruneDialogProps) {
  const config = useStorageConfig(storage, { enabled: open })
  const groups = useMemo(() => backupGroups(backups), [backups])
  const [selected, setSelected] = useState<string | undefined>(group ? groupKey(group) : undefined)
  const [keep, setKeep] = useState<PruneKeep>({})
  const [seeded, setSeeded] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelected(group ? groupKey(group) : undefined)
    setSeeded(false)
    setKeep({})
  }, [open])

  // Start from the storage's retention settings (when readable).
  useEffect(() => {
    if (!open || seeded || config.isPending) return
    setKeep(parsePruneBackups(config.data?.['prune-backups']))
    setSeeded(true)
  }, [open, seeded, config.isPending, config.data])

  const target: BackupGroup | undefined = groups.find((g) => groupKey(g) === selected)
  const params = useMemo(
    () => pruneParams(keep, target ? { type: target.type, vmid: target.vmid } : undefined),
    [keep, target],
  )
  const debounced = useDebounced(params, 300)
  const preview = useQuery({
    queryKey: storageKeys.prune(node, storage, debounced),
    queryFn: ({ signal }) => fetchPrunePreview(node, storage, debounced, signal),
    enabled: open && seeded,
    placeholderData: keepPreviousData,
    staleTime: 0,
  })

  const entries = useMemo(
    () => [...(preview.data ?? [])].sort((a, b) => b.ctime - a.ctime),
    [preview.data],
  )
  const reasons = useMemo(() => pruneKeepReasons(entries, keep), [entries, keep])
  const removeCount = entries.filter((e) => e.mark === 'remove').length
  const stale = preview.isFetching || debounced !== params

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="清理备份"
      description={target ? `${target.type === 'lxc' ? 'CT' : 'VM'} ${target.vmid} 在 ${storage} 上的备份` : `${storage} 上的所有备份`}
      submitLabel={removeCount ? `删除 ${removeCount} 个备份` : '清理'}
      destructive
      submitDisabled={!seeded || stale || removeCount === 0}
      onSubmit={() =>
        runTask(pruneBackups(node, storage, params), {
          title: target ? `清理 ${target.type === 'lxc' ? 'CT' : 'VM'} ${target.vmid} 的备份` : `清理 ${storage} 的备份`,
          invalidate: [storageKeys.contentAll(node, storage), storageKeys.status(node, storage)],
        })
      }
    >
      <FormField label="范围">
        <SelectField
          value={selected}
          onValueChange={setSelected}
          emptyOption="全部备份"
          options={groups.map((g) => ({
            value: groupKey(g),
            label: `${g.type === 'lxc' ? 'CT' : 'VM'} ${g.vmid}`,
            description: `${g.count} 个备份`,
          }))}
        />
      </FormField>

      <div className="grid gap-2">
        <div className="text-sm font-medium text-foreground">保留数量</div>
        <FormRow cols={3} className="grid-cols-3 gap-x-2.5 gap-y-3 sm:gap-x-4">
          {PRUNE_KEYS.map((k) => (
            <FormField
              key={k}
              label={<span className="text-xs font-normal text-muted-foreground">{PRUNE_LABEL[k]}</span>}
              name={k}
              className="gap-1.5"
            >
              <NumberInput
                aria-label={`保留${PRUNE_LABEL[k]}`}
                value={keep[k]}
                onChange={(v) => setKeep((prev) => ({ ...prev, [k]: v && v > 0 ? v : undefined }))}
                min={0}
                max={10000}
                placeholder="不限"
                inputMode="numeric"
              />
            </FormField>
          ))}
        </FormRow>
        <p className="text-xs leading-relaxed text-muted-foreground">
          先保留最近 N 个，再按每小时、天、周、月、年各保留最新的一个。都不填则全部保留；受保护的备份不会删除。
        </p>
      </div>

      <section aria-label="预览" className="grid gap-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium text-foreground">预览</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular">
            {stale && <Loader2 className="size-3 animate-spin" aria-hidden />}
            {preview.data && `保留 ${entries.length - removeCount} · 删除 ${removeCount}`}
          </span>
        </div>
        {preview.isError ? (
          <p className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{errorMessage(preview.error)}</p>
        ) : !preview.data ? (
          <div className="grid gap-1.5">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-11 rounded-lg" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState icon={Archive} title="没有备份" className="py-6" />
        ) : (
          <ul
            className={cn(
              'max-h-72 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/70 transition-opacity',
              stale && 'opacity-60',
            )}
          >
            {entries.map((e) => (
              <PruneRow key={e.volid} entry={e} reason={reasons.get(e.volid)} showGroup={!target} />
            ))}
          </ul>
        )}
      </section>
    </FormDialog>
  )
}

function PruneRow({ entry: e, reason, showGroup }: { entry: PruneEntry; reason?: string; showGroup: boolean }) {
  const remove = e.mark === 'remove'
  return (
    <li className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm">
      <span className={cn('min-w-0 flex-1 truncate tabular', remove ? 'text-muted-foreground line-through' : 'text-foreground')}>
        {formatDateTime(e.ctime)}
        {showGroup && (
          <span className="ml-2 text-xs text-muted-foreground no-underline">
            {e.type === 'lxc' ? 'CT' : 'VM'} {e.vmid}
          </span>
        )}
      </span>
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs',
          remove && 'bg-destructive/12 text-destructive',
          e.mark === 'keep' && 'bg-success/12 text-success-strong',
          (e.mark === 'protected' || e.mark === 'renamed') && 'bg-info/12 text-info',
          'paper:bg-secondary',
        )}
      >
        {e.mark === 'protected' && <Shield className="size-3" aria-hidden />}
        {remove ? '删除' : e.mark === 'protected' ? '受保护' : e.mark === 'renamed' ? '已改名，保留' : `保留 · ${reason ?? ''}`}
      </span>
    </li>
  )
}
