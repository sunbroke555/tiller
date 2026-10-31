// Palette commands (area guest-snapshots-backup): jump to a guest's snapshot
// or backup tab ("快照 web-01", "备份 web-01").

import { Archive, Camera } from 'lucide-react'

import type { CommandDef } from '@/features/command/types'
import { guestPath } from '@/lib/resources'

export const guestBackupCommands: CommandDef[] = [
  {
    scope: 'guest',
    id: 'guest-snapshots',
    label: '快照',
    icon: Camera,
    order: 300,
    keywords: ['snapshot', 'rollback', 'kuaizhao', '回滚'],
    visible: (g) => g.template !== 1,
    run: (g, { navigate }) => navigate(guestPath(g, 'snapshots')),
  },
  {
    scope: 'guest',
    id: 'guest-backups',
    label: '备份',
    icon: Archive,
    order: 310,
    keywords: ['backup', 'restore', 'vzdump', 'beifen', '恢复'],
    run: (g, { navigate }) => navigate(guestPath(g, 'backup')),
  },
]
