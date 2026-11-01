// PBS file-level restore: helpers for the file browser (official
// Proxmox.window.FileBrowser). Paths travel base64-encoded; the root is "/".

import type { FileRestoreEntry, FileRestoreType } from '@/api/storage-browser'

export const FILE_TYPE_LABEL: Record<string, string> = {
  b: '块设备',
  c: '字符设备',
  d: '目录',
  f: '文件',
  h: '硬链接',
  l: '软链接',
  p: '管道',
  s: '套接字',
  v: '虚拟',
}

export function fileTypeLabel(type: FileRestoreType): string {
  return FILE_TYPE_LABEL[type] ?? '未知'
}

/** Files, hard links and directories can be downloaded (directories as .zip / .tar.zst). */
export function canDownloadEntry(type: FileRestoreType): boolean {
  return type === 'f' || type === 'h' || type === 'd'
}

/** Directories (and the archives / partitions of VM backups) can be opened. */
export function isBrowsable(e: Pick<FileRestoreEntry, 'type' | 'leaf'>): boolean {
  if (e.leaf !== undefined) return !(e.leaf === true || e.leaf === 1)
  return e.type === 'd' || e.type === 'v'
}

/** Decode a base64 `filepath` into the readable path (UTF-8; invalid input is returned as is). */
export function decodeFilepath(filepath: string): string {
  if (filepath === '/') return '/'
  try {
    const bin = atob(filepath)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return filepath
  }
}

/** Directories first, then by name (natural order). */
export function sortEntries(list: readonly FileRestoreEntry[]): FileRestoreEntry[] {
  return [...list].sort((a, b) => {
    const da = isBrowsable(a) ? 0 : 1
    const db = isBrowsable(b) ? 0 : 1
    if (da !== db) return da - db
    return a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' })
  })
}

/** Name of the downloaded file: directories become .zip or .tar.zst archives. */
export function downloadFilename(e: Pick<FileRestoreEntry, 'text' | 'type'>, tar = false): string {
  const base = e.text.replace(/[/\\]+/g, '_') || 'download'
  if (e.type !== 'd') return base
  return `${base}${tar ? '.tar.zst' : '.zip'}`
}

/** VM backups (vm/… on PBS, format pbs-vm) show their disk archives first. */
export function isVmArchive(volid: string, format?: string): boolean {
  return format === 'pbs-vm' || /:backup\/vm\//.test(volid)
}

export interface Crumb {
  filepath: string
  text: string
  type?: FileRestoreType
}

/** Push a directory onto the breadcrumb, or cut back to an existing one. */
export function enterCrumb(path: readonly Crumb[], next: Crumb): Crumb[] {
  const i = path.findIndex((c) => c.filepath === next.filepath)
  return i >= 0 ? path.slice(0, i + 1) : [...path, next]
}
