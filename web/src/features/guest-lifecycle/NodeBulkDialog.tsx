import { useClusterResources } from '@/api/queries'
import { isGuest } from '@/api/types'
import type { ActionDialogProps } from '@/components/page/registry'
import type { NodeActionContext } from '@/features/node/types'

import { BulkDialog } from './BulkDialog'
import type { BulkAction } from './params'

/** Bulk dialog over all guests of one node (node page "更多" menu). */
function NodeBulkDialog({ ctx, open, onOpenChange, action }: ActionDialogProps<NodeActionContext> & { action: BulkAction }) {
  const { data: guests = [] } = useClusterResources({
    select: (all) =>
      all
        .filter(isGuest)
        .filter((g) => g.node === ctx.node)
        // Templates only move; suspend is for VMs only.
        .filter((g) => (action === 'migrate' || g.template !== 1) && (action !== 'suspend' || g.type === 'qemu')),
  })
  return <BulkDialog open={open} onOpenChange={onOpenChange} action={action} guests={guests} scope={{ kind: 'node', node: ctx.node }} />
}

export const NodeBulkStartDialog = (p: ActionDialogProps<NodeActionContext>) => <NodeBulkDialog {...p} action="start" />
export const NodeBulkShutdownDialog = (p: ActionDialogProps<NodeActionContext>) => <NodeBulkDialog {...p} action="shutdown" />
export const NodeBulkSuspendDialog = (p: ActionDialogProps<NodeActionContext>) => <NodeBulkDialog {...p} action="suspend" />
export const NodeBulkMigrateDialog = (p: ActionDialogProps<NodeActionContext>) => <NodeBulkDialog {...p} action="migrate" />
