// Contracts for the storage detail page (/storage/:node/:storage/:tab?).

import type { NavigateFunction } from 'react-router'

import type { StorageContent, StorageResource } from '@/api/types'
import type { ActionDef, TabDef } from '@/components/page/registry'

/** Props every storage tab component receives. */
export interface StorageTabProps {
  node: string
  storage: string
  /** Live entry from /cluster/resources (usage, content list, plugin type, shared). */
  resource: StorageResource
  /** Set for content tabs: which content type the tab lists. */
  content?: StorageContent
}

export interface StorageActionContext extends StorageTabProps {
  navigate: NavigateFunction
}

export interface StorageTabDef extends TabDef<StorageTabProps> {
  /** Passed to the component as `content`; the tab shows only if the storage holds it. */
  content?: StorageContent
}

export type StorageActionDef = ActionDef<StorageActionContext>

export const STORAGE_CONTENT_LABEL: Record<StorageContent, string> = {
  images: '虚拟机磁盘',
  rootdir: '容器卷',
  iso: 'ISO 镜像',
  vztmpl: '容器模板',
  backup: '备份',
  snippets: '片段',
  import: '导入',
}

/** "images,rootdir" → ['images', 'rootdir'] (unknown types dropped). */
export function storageContents(content: string | undefined): StorageContent[] {
  return (content ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is StorageContent => c in STORAGE_CONTENT_LABEL)
}
