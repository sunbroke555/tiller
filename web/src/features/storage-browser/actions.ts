// Storage page actions (area storage-browser): upload, download from URL,
// templates, OCI pull, prune. Order range 100–199. Registered in
// features/storage/registry.ts. Upload and download target the open content
// tab when it is ISO / templates / import.

import { lazy } from 'react'
import { Container, Download, Package, Scissors, Upload } from 'lucide-react'

import { getSession } from '@/api/session'
import type { StorageContent } from '@/api/types'
import type { StorageActionDef } from '@/features/storage/types'
import { storageContents } from '@/features/storage/types'

import { backupWriteDenied, downloadDenied, transferContents, uploadDenied } from './permissions'

const dialogs = () => import('./ActionDialogs')

const has = (content: string | undefined, c: StorageContent) => storageContents(content).includes(c)

export const storageBrowserActions: StorageActionDef[] = [
  {
    id: 'upload',
    label: '上传',
    icon: Upload,
    order: 100,
    placement: 'primary',
    section: '添加内容',
    visible: ({ resource }) => transferContents(resource.content, resource.plugintype).length > 0,
    disabled: ({ resource }) =>
      resource.status !== 'available' ? '存储不可用' : uploadDenied(getSession()?.cap),
    dialog: lazy(() => dialogs().then((m) => ({ default: m.UploadAction }))),
  },
  {
    id: 'download-url',
    label: '从 URL 下载',
    icon: Download,
    order: 110,
    placement: 'primary',
    section: '添加内容',
    visible: ({ resource }) => transferContents(resource.content, resource.plugintype).length > 0,
    disabled: ({ resource }) =>
      resource.status !== 'available' ? '存储不可用' : downloadDenied(getSession()?.cap),
    dialog: lazy(() => dialogs().then((m) => ({ default: m.DownloadAction }))),
  },
  {
    id: 'templates',
    label: '容器模板',
    icon: Package,
    order: 120,
    placement: 'primary',
    section: '添加内容',
    visible: ({ resource }) => has(resource.content, 'vztmpl'),
    disabled: ({ resource }) =>
      resource.status !== 'available' ? '存储不可用' : uploadDenied(getSession()?.cap),
    dialog: lazy(() => dialogs().then((m) => ({ default: m.TemplatesAction }))),
  },
  {
    id: 'oci-pull',
    label: '拉取 OCI 镜像',
    icon: Container,
    order: 130,
    section: '添加内容',
    visible: ({ resource }) => has(resource.content, 'vztmpl'),
    disabled: ({ resource }) =>
      resource.status !== 'available' ? '存储不可用' : downloadDenied(getSession()?.cap),
    dialog: lazy(() => dialogs().then((m) => ({ default: m.OciAction }))),
  },
  {
    id: 'prune',
    label: '清理备份',
    icon: Scissors,
    order: 150,
    section: '备份',
    destructive: true,
    visible: ({ resource }) => has(resource.content, 'backup'),
    disabled: () => backupWriteDenied(getSession()?.cap),
    dialog: lazy(() => dialogs().then((m) => ({ default: m.PruneAction }))),
  },
]
