// Privilege checks for the storage actions, from the ticket's capability
// summary (like the official storage browser). Unknown capabilities (an old
// session without `cap`) allow the action; PVE still enforces permissions.

import type { TransferContent } from '@/api/storage-browser'
import type { Capabilities } from '@/api/types'
import { storageContents } from '@/features/storage/types'

const TRANSFER_ORDER: TransferContent[] = ['iso', 'vztmpl', 'import']

/** Content types of a storage that accept uploads / URL downloads. */
export function transferContents(content: string | undefined, plugintype?: string): TransferContent[] {
  if (plugintype === 'esxi') return []
  const c = storageContents(content)
  return TRANSFER_ORDER.filter((t) => c.includes(t))
}

/** Reason upload/download is not allowed, or null. */
export function uploadDenied(cap: Capabilities | undefined): string | null {
  if (!cap?.storage) return null
  return cap.storage['Datastore.AllocateTemplate'] ? null : '没有权限（需要 Datastore.AllocateTemplate）'
}

/** Reason "download from URL" is not allowed, or null. */
export function downloadDenied(cap: Capabilities | undefined): string | null {
  const upload = uploadDenied(cap)
  if (upload) return upload
  if (!cap?.nodes) return null
  const n = cap.nodes
  return (n['Sys.Audit'] && n['Sys.Modify']) || n['Sys.AccessNetwork'] ? null : '没有权限（需要 Sys.AccessNetwork）'
}

/** Reason prune / protect / notes are not allowed, or null. */
export function backupWriteDenied(cap: Capabilities | undefined): string | null {
  if (!cap?.storage) return null
  return cap.storage['Datastore.Allocate'] || cap.storage['Datastore.AllocateSpace'] ? null : '没有权限（需要 Datastore.AllocateSpace）'
}
