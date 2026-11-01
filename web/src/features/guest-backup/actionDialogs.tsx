// Dialog components behind the guest page actions (lazy loaded from actions.ts).

import type { ActionDialogProps } from '@/components/page/registry'
import type { GuestActionContext } from '@/features/guest/types'

import { BackupNowDialog } from './BackupNowDialog'
import { TakeSnapshotDialog } from './SnapshotDialogs'

export function TakeSnapshotAction({ ctx, open, onOpenChange }: ActionDialogProps<GuestActionContext>) {
  return (
    <TakeSnapshotDialog
      guest={{ node: ctx.node, type: ctx.type, vmid: ctx.vmid, name: ctx.name, running: ctx.guest.status === 'running', lock: ctx.guest.lock }}
      open={open}
      onOpenChange={onOpenChange}
    />
  )
}

export function BackupNowAction({ ctx, open, onOpenChange }: ActionDialogProps<GuestActionContext>) {
  return <BackupNowDialog node={ctx.node} type={ctx.type} vmid={ctx.vmid} name={ctx.name} open={open} onOpenChange={onOpenChange} />
}
