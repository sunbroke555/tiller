// Tabs and actions of the storage page. Content tabs all render the
// storage-browser area's ContentTab with a different `content`.

import { lazyComponent as lazy } from '@/lib/lazyComponent'
import { Archive, Box, Disc3, FileCode, FileInput, HardDrive, LayoutDashboard, Package, Users } from 'lucide-react'

import { storageBrowserActions } from '@/features/storage-browser/actions'

import { storageContents, STORAGE_CONTENT_LABEL, type StorageActionDef, type StorageTabDef } from './types'
import type { StorageContent } from '@/api/types'

const ContentTab = lazy(() => import('@/features/storage-browser/ContentTab'))

const CONTENT_TABS: [StorageContent, StorageTabDef['icon'], number][] = [
  ['backup', Archive, 20],
  ['iso', Disc3, 30],
  ['vztmpl', Package, 40],
  ['images', HardDrive, 50],
  ['rootdir', Box, 60],
  ['snippets', FileCode, 70],
  ['import', FileInput, 80],
]

export const storageTabs: StorageTabDef[] = [
  {
    id: 'summary',
    title: '概要',
    icon: LayoutDashboard,
    order: 10,
    component: lazy(() => import('@/features/storage-browser/SummaryTab')),
  },
  ...CONTENT_TABS.map(
    ([content, icon, order]): StorageTabDef => ({
      id: content,
      title: STORAGE_CONTENT_LABEL[content],
      icon,
      order,
      content,
      component: ContentTab,
      visible: ({ resource }) => storageContents(resource.content).includes(content),
    }),
  ),
  {
    id: 'permissions',
    title: '权限',
    icon: Users,
    order: 120,
    permission: { privs: ['Permissions.Modify', 'Datastore.Allocate'], any: true },
    component: lazy(() => import('@/features/access-control/StoragePermissionsTab')),
  },
]

export const storageActions: StorageActionDef[] = [...storageBrowserActions]
