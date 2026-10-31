// Guest lifecycle actions (area guest-lifecycle): migrate, clone, convert to
// template, HA, protection, delete. Order range 400–499, all in "更多".
// Node bulk actions (start/stop/suspend/migrate all) go in nodeBulkActions,
// order range 300–399 on the node page.
// Registered in features/guest/registry.ts and features/node/registry.ts.

import { lazy } from 'react'
import { Copy, HeartPulse, LayoutTemplate, MoveRight, Pause, Play, Power, Send, Shield, Trash2 } from 'lucide-react'

import { convertToTemplate } from '@/api/guest-lifecycle'
import { runTask } from '@/components/tasks/tracker'
import type { GuestActionDef } from '@/features/guest/types'
import type { NodeActionDef } from '@/features/node/types'

const MigrateDialog = lazy(() => import('./MigrateDialog'))
const CloneDialog = lazy(() => import('./CloneDialog'))
const RemoveDialog = lazy(() => import('./RemoveDialog'))
const ProtectionDialog = lazy(() => import('./ProtectionDialog'))
const HaDialog = lazy(() => import('./HaDialog'))

const bulk = (name: 'NodeBulkStartDialog' | 'NodeBulkShutdownDialog' | 'NodeBulkSuspendDialog' | 'NodeBulkMigrateDialog') =>
  lazy(() => import('./NodeBulkDialog').then((m) => ({ default: m[name] })))

/** Locks during which the lifecycle operations cannot run. */
const busyLock = ({ guest }: { guest: { lock?: string } }) =>
  guest.lock && guest.lock !== 'suspended' ? `已锁定（${guest.lock}）` : false

export const guestLifecycleActions: GuestActionDef[] = [
  {
    id: 'migrate',
    label: '迁移',
    icon: Send,
    order: 400,
    section: '管理',
    disabled: busyLock,
    dialog: MigrateDialog,
  },
  {
    id: 'clone',
    label: '克隆',
    icon: Copy,
    order: 410,
    // Primary: the main action of a template; for a running guest it overflows
    // into "更多" behind 关机 / 重启 / 控制台.
    placement: 'primary',
    section: '管理',
    disabled: busyLock,
    dialog: CloneDialog,
  },
  {
    id: 'template',
    label: '转换为模板',
    icon: LayoutTemplate,
    order: 420,
    section: '管理',
    visible: ({ guest }) => guest.template !== 1,
    disabled: ({ guest }) =>
      guest.status !== 'stopped' ? '需要先停止' : guest.lock ? `已锁定（${guest.lock}）` : false,
    confirm: ({ name, type, vmid }) => ({
      title: `把 ${name} 转换为模板？`,
      description: `${type === 'qemu' ? 'VM' : 'CT'} ${vmid} 转换后不能再启动，也不能转回普通客户机。之后可以从它快速克隆出新的客户机。`,
      confirmLabel: '转换为模板',
    }),
    run: ({ node, type, vmid, name }) => runTask(convertToTemplate(node, type, vmid), { title: `把 ${name} 转换为模板` }),
  },
  {
    id: 'ha',
    label: ({ guest }) => (guest.hastate && guest.hastate !== 'unmanaged' ? 'HA 设置' : '加入 HA'),
    icon: HeartPulse,
    order: 430,
    section: '管理',
    visible: ({ guest }) => guest.template !== 1,
    dialog: HaDialog,
  },
  {
    id: 'protection',
    label: '删除保护',
    icon: Shield,
    order: 440,
    section: '管理',
    dialog: ProtectionDialog,
  },
  {
    id: 'remove',
    label: '删除',
    icon: Trash2,
    order: 490,
    section: '危险操作',
    destructive: true,
    disabled: busyLock,
    dialog: RemoveDialog,
  },
]

export const nodeBulkActions: NodeActionDef[] = [
  {
    id: 'bulk-start',
    label: '批量启动',
    icon: Play,
    order: 300,
    section: '批量操作',
    visible: ({ resource }) => resource.status === 'online',
    dialog: bulk('NodeBulkStartDialog'),
  },
  {
    id: 'bulk-shutdown',
    label: '批量关机',
    icon: Power,
    order: 310,
    section: '批量操作',
    visible: ({ resource }) => resource.status === 'online',
    dialog: bulk('NodeBulkShutdownDialog'),
  },
  {
    id: 'bulk-suspend',
    label: '批量挂起',
    icon: Pause,
    order: 320,
    section: '批量操作',
    visible: ({ resource }) => resource.status === 'online',
    dialog: bulk('NodeBulkSuspendDialog'),
  },
  {
    id: 'bulk-migrate',
    label: '批量迁移',
    icon: MoveRight,
    order: 330,
    section: '批量操作',
    visible: ({ resource }) => resource.status === 'online',
    dialog: bulk('NodeBulkMigrateDialog'),
  },
]
