// Page-level dialogs of the storage actions (registered in actions.ts, loaded lazily).

import { useParams } from 'react-router'

import { useStorageContent, type TransferContent } from '@/api/storage-browser'
import type { ActionDialogProps } from '@/components/page/registry'
import type { StorageActionContext } from '@/features/storage/types'

import { DownloadUrlDialog } from './DownloadUrlDialog'
import { OciPullDialog } from './OciPullDialog'
import { transferContents } from './permissions'
import { PruneDialog } from './PruneDialog'
import { TemplateCatalogDialog } from './TemplateCatalogDialog'
import { UploadDialog } from './UploadDialog'

type Props = ActionDialogProps<StorageActionContext>

/** Content type of the open tab, when it is one the dialog can target. */
function useTabContent(options: TransferContent[]): TransferContent | undefined {
  const { tab } = useParams()
  return options.find((c) => c === tab)
}

export function UploadAction({ ctx, open, onOpenChange }: Props) {
  const contents = transferContents(ctx.resource.content, ctx.resource.plugintype)
  const initial = useTabContent(contents)
  return (
    <UploadDialog
      node={ctx.node}
      storage={ctx.storage}
      contents={contents}
      initialContent={initial}
      open={open}
      onOpenChange={onOpenChange}
    />
  )
}

export function DownloadAction({ ctx, open, onOpenChange }: Props) {
  const contents = transferContents(ctx.resource.content, ctx.resource.plugintype)
  const initial = useTabContent(contents)
  return (
    <DownloadUrlDialog
      node={ctx.node}
      storage={ctx.storage}
      contents={contents}
      initialContent={initial}
      open={open}
      onOpenChange={onOpenChange}
    />
  )
}

export function TemplatesAction({ ctx, open, onOpenChange }: Props) {
  return <TemplateCatalogDialog node={ctx.node} storage={ctx.storage} open={open} onOpenChange={onOpenChange} />
}

export function OciAction({ ctx, open, onOpenChange }: Props) {
  return <OciPullDialog node={ctx.node} storage={ctx.storage} open={open} onOpenChange={onOpenChange} />
}

export function PruneAction({ ctx, open, onOpenChange }: Props) {
  const { data } = useStorageContent(ctx.node, ctx.storage, 'backup', { enabled: open })
  return <PruneDialog node={ctx.node} storage={ctx.storage} backups={data ?? []} open={open} onOpenChange={onOpenChange} />
}
