// Guest snapshot / backup actions (area guest-snapshots-backup): "创建快照",
// "立即备份". Order range 300–349. Registered in features/guest/registry.ts.

import { lazy } from 'react'
import { Archive, Camera } from 'lucide-react'

import type { GuestActionDef } from '@/features/guest/types'

export const guestBackupActions: GuestActionDef[] = [
  {
    id: 'snapshot',
    label: '创建快照',
    icon: Camera,
    order: 300,
    section: '快照与备份',
    visible: ({ guest }) => guest.template !== 1,
    disabled: ({ guest }) => (guest.lock ? `已锁定（${guest.lock}）` : null),
    dialog: lazy(() => import('./actionDialogs').then((m) => ({ default: m.TakeSnapshotAction }))),
  },
  {
    id: 'backup',
    label: '立即备份',
    icon: Archive,
    order: 310,
    section: '快照与备份',
    disabled: ({ guest }) => (guest.lock ? `已锁定（${guest.lock}）` : null),
    dialog: lazy(() => import('./actionDialogs').then((m) => ({ default: m.BackupNowAction }))),
  },
]
