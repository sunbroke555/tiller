import { useEffect, useState } from 'react'

import { storageKeys, updateVolume, type StorageVolume } from '@/api/storage-browser'
import { FieldTextarea, FormDialog, FormField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'

import { volumeName } from './volumes'

export interface NotesDialogProps {
  node: string
  storage: string
  volume: StorageVolume
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Edit the notes of a backup (PUT …/content/{volume} notes). */
export function NotesDialog({ node, storage, volume, open, onOpenChange }: NotesDialogProps) {
  const [notes, setNotes] = useState(volume.notes ?? '')
  useEffect(() => {
    if (open) setNotes(volume.notes ?? '')
  }, [open, volume.notes])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="编辑备注"
      description={volumeName(volume)}
      submitDisabled={notes === (volume.notes ?? '')}
      onSubmit={() =>
        runTask(updateVolume(node, storage, volume.volid, { notes }), {
          title: '保存备注',
          syncSuccessMessage: '备注已保存',
          invalidate: [storageKeys.contentAll(node, storage)],
        })
      }
    >
      <FormField label="备注" name="notes" hint="备份任务的备注模板（{{guestname}} 等）只在创建时展开">
        <FieldTextarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} autoFocus />
      </FormField>
    </FormDialog>
  )
}
