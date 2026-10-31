import { useEffect, useState } from 'react'

import { useGuestConfig } from '@/api/guest-core'
import { setGuestConfig } from '@/api/guest-lifecycle'
import { FormDialog, SwitchField } from '@/components/form'
import type { ActionDialogProps } from '@/components/page/registry'
import { runTask } from '@/components/tasks/tracker'
import { Skeleton } from '@/components/ui/skeleton'
import type { GuestActionContext } from '@/features/guest/types'
import { configUpdateParams } from '@/lib/propstring'

/** Toggle the `protection` flag (blocks deleting the guest and its disks). */
export default function ProtectionDialog({ ctx, open, onOpenChange }: ActionDialogProps<GuestActionContext>) {
  const { node, type, vmid, name } = ctx
  const config = useGuestConfig(node, type, vmid, { enabled: open })
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (open && config.data) setOn(config.data.protection === 1)
  }, [open, config.data?.digest])

  const params = config.data ? configUpdateParams(config.data, { protection: on ? 1 : '' }, { digest: config.data.digest }) : null
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`删除保护 · ${name}`}
      size="sm"
      submitDisabled={!params}
      onSubmit={() =>
        runTask(setGuestConfig(node, type, vmid, params!), {
          title: `${on ? '启用' : '取消'} ${name} 的删除保护`,
          syncSuccessMessage: on ? '已启用删除保护' : '已取消删除保护',
        })
      }
    >
      {config.isPending ? (
        <Skeleton className="h-11 w-full" />
      ) : (
        <SwitchField
          label="启用删除保护"
          description="开启后不能删除这台客户机，也不能删除它的磁盘，防止误操作。"
          checked={on}
          onCheckedChange={setOn}
        />
      )}
    </FormDialog>
  )
}
