import { Archive, Box, Disc3, FileCode, FileInput, HardDrive, Package, type LucideIcon } from 'lucide-react'

import type { StorageContent } from '@/api/types'

/** Plugin type → display name (official format_storage_type). */
export const STORAGE_TYPE_LABEL: Record<string, string> = {
  dir: '目录',
  lvm: 'LVM',
  lvmthin: 'LVM-Thin',
  zfspool: 'ZFS',
  zfs: 'ZFS over iSCSI',
  btrfs: 'BTRFS',
  nfs: 'NFS',
  cifs: 'SMB/CIFS',
  glusterfs: 'GlusterFS',
  cephfs: 'CephFS',
  rbd: 'Ceph RBD',
  iscsi: 'iSCSI',
  iscsidirect: 'iSCSI (libiscsi)',
  pbs: 'Proxmox Backup Server',
  esxi: 'ESXi',
}

export function storageTypeLabel(type: string | undefined): string {
  if (!type) return '—'
  return STORAGE_TYPE_LABEL[type] ?? type
}

export const CONTENT_ICON: Record<StorageContent, LucideIcon> = {
  backup: Archive,
  iso: Disc3,
  vztmpl: Package,
  images: HardDrive,
  rootdir: Box,
  snippets: FileCode,
  import: FileInput,
}

/** Tab order of the content types (same as the storage page tabs). */
export const CONTENT_ORDER: StorageContent[] = ['backup', 'iso', 'vztmpl', 'images', 'rootdir', 'snippets', 'import']

/** Short noun for one item of a content type ("删除这个 ISO 镜像"). */
export const CONTENT_ITEM: Record<StorageContent, string> = {
  backup: '备份',
  iso: 'ISO 镜像',
  vztmpl: '容器模板',
  images: '磁盘',
  rootdir: '容器卷',
  snippets: '片段',
  import: '导入文件',
}

export const UPLOAD_HINT: Record<'iso' | 'vztmpl' | 'import', string> = {
  iso: '.iso 或 .img 光盘镜像',
  vztmpl: '.tar.gz / .tar.xz / .tar.zst 容器模板',
  import: '.ova 虚拟机包，或 .qcow2 / .vmdk / .raw 磁盘镜像',
}
