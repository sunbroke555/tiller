import { useEffect, useId, useState } from 'react'

import { destroyDiskStorage, type DiskStorageKind } from '@/api/node-disks'
import { CheckboxField, FormDialog } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Input } from '@/components/ui/input'

import { destroyParams, destroyTaskTitle, STORAGE_KIND_LABEL, verbObject } from './model'
import { useDiskPermissions } from './shared'

export interface DestroyTarget {
  kind: DiskStorageKind
  /** Path segment of DELETE …/{kind}/{name}. */
  name: string
  /** What the user types to confirm and sees in the title ("pve/data" for a thin pool). */
  label: string
  /** LVM-Thin only. */
  volumeGroup?: string
}

/**
 * PVE.window.SafeDestroyStorage: type the ID, optionally wipe the disks and
 * remove the storage configuration (both on by default).
 */
export function DestroyDialog({
  node,
  target,
  open,
  onOpenChange,
}: {
  node: string
  target: DestroyTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const perms = useDiskPermissions()
  const [typed, setTyped] = useState('')
  const [cleanupDisks, setCleanupDisks] = useState(true)
  const [cleanupConfig, setCleanupConfig] = useState(true)
  const inputId = useId()

  useEffect(() => {
    if (!open) {
      setTyped('')
      setCleanupDisks(true)
      setCleanupConfig(true)
    }
  }, [open])

  if (!target) return null
  const what = STORAGE_KIND_LABEL[target.kind]
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${verbObject('删除', target.kind)} ${target.label}？`}
      description={
        target.kind === 'directory'
          ? '卸载目录并删除它的挂载单元。目录里的数据随文件系统一起丢失（勾选清理磁盘时）。'
          : `${what}和其中的所有卷都会被删除，数据无法恢复。`
      }
      destructive
      submitLabel="删除"
      submitDisabled={typed.trim() !== target.label}
      dirty={false}
      onSubmit={() =>
        runTask(
          destroyDiskStorage(
            node,
            target.kind,
            target.name,
            destroyParams({ cleanupDisks, cleanupConfig: cleanupConfig && perms.storage, volumeGroup: target.volumeGroup }),
          ),
          { title: destroyTaskTitle(target.kind, target.label), node },
        )
      }
    >
      <div className="grid gap-1">
        <CheckboxField
          label="清理磁盘"
          description="擦除磁盘上的标签和残留，之后可以重新使用。"
          checked={cleanupDisks}
          onCheckedChange={setCleanupDisks}
        />
        <CheckboxField
          label="清理存储配置"
          description={
            perms.storage
              ? '从存储配置里移除使用它的存储（只用于本节点时），或把本节点从其节点列表中去掉。'
              : '没有权限（需要 /storage 上的 Datastore.Allocate）。'
          }
          checked={cleanupConfig && perms.storage}
          onCheckedChange={setCleanupConfig}
          disabled={!perms.storage}
        />
      </div>
      <div className="grid gap-2">
        <label htmlFor={inputId} className="block text-sm leading-relaxed text-muted-foreground">
          请输入 <span className="font-mono font-medium break-all text-foreground select-all">{target.label}</span> 以确认
        </label>
        <Input
          id={inputId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
    </FormDialog>
  )
}
