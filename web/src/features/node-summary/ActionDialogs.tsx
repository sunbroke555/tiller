// Dialog wrappers for node page actions (lazy loaded from actions.ts).

import type { ActionDialogProps } from '@/components/page/registry'
import type { NodeActionContext } from '@/features/node/types'

import { PackageVersionsDialog } from './PackageVersionsDialog'
import { SystemReportDialog } from './SystemReportDialog'

export function PackageVersionsAction({ ctx, open, onOpenChange }: ActionDialogProps<NodeActionContext>) {
  return <PackageVersionsDialog node={ctx.node} open={open} onOpenChange={onOpenChange} />
}

export function SystemReportAction({ ctx, open, onOpenChange }: ActionDialogProps<NodeActionContext>) {
  return <SystemReportDialog node={ctx.node} open={open} onOpenChange={onOpenChange} />
}
