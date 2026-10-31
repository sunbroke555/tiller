import {
  ExternalLink,
  FileInput,
  FileText,
  History,
  Scissors,
  Shield,
  ShieldOff,
  StickyNote,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

import type { StorageVolume } from '@/api/storage-browser'

import { backupGuestType, importKind, volumeVmid } from './volumes'

export type VolumeDialogKind = 'details' | 'delete' | 'notes' | 'restore' | 'prune' | 'config' | 'import'

export interface VolumeAction {
  id: string
  label: string
  icon: LucideIcon
  destructive?: boolean
  /** Reason the action is unavailable (shown as hint). */
  disabled?: string | null
  run: () => void
}

export interface VolumeActionEnv {
  open: (kind: VolumeDialogKind, volume: StorageVolume) => void
  toggleProtected: (volume: StorageVolume) => void
  /** Navigate to the owning guest, when it exists. */
  openGuest?: (() => void) | undefined
  deleteBlocked: string | null
}

/** Actions for one volume, by content type (official storage views' toolbars). */
export function volumeActions(v: StorageVolume, env: VolumeActionEnv): VolumeAction[] {
  const out: VolumeAction[] = []
  if (v.content === 'backup') {
    const type = backupGuestType(v)
    const vmid = volumeVmid(v)
    if (type) out.push({ id: 'restore', label: '恢复', icon: History, run: () => env.open('restore', v) })
    out.push({ id: 'config', label: '查看配置', icon: FileText, run: () => env.open('config', v) })
    out.push({ id: 'notes', label: '编辑备注', icon: StickyNote, run: () => env.open('notes', v) })
    out.push(
      v.protected === 1
        ? { id: 'unprotect', label: '取消保护', icon: ShieldOff, run: () => env.toggleProtected(v) }
        : { id: 'protect', label: '保护', icon: Shield, run: () => env.toggleProtected(v) },
    )
    if (type && vmid !== undefined) {
      out.push({ id: 'prune', label: '清理此客户机的备份', icon: Scissors, run: () => env.open('prune', v) })
    }
  }
  if (v.content === 'import' && importKind(v.format)) {
    out.push({ id: 'import', label: '导入', icon: FileInput, run: () => env.open('import', v) })
  }
  if ((v.content === 'images' || v.content === 'rootdir') && env.openGuest) {
    out.push({ id: 'guest', label: '打开客户机', icon: ExternalLink, run: env.openGuest })
  }
  out.push({
    id: 'delete',
    label: '删除',
    icon: Trash2,
    destructive: true,
    disabled: env.deleteBlocked,
    run: () => env.open('delete', v),
  })
  return out
}
