import { describe, expect, it } from 'vitest'

import { fileRestoreDownloadUrl, type FileRestoreEntry, type StorageVolume } from '@/api/storage-browser'

import {
  canDownloadEntry,
  decodeFilepath,
  downloadFilename,
  enterCrumb,
  fileTypeLabel,
  isBrowsable,
  isVmArchive,
  sortEntries,
} from './fileRestore'
import { volumeActions } from './volumeActions'

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

// Shapes as proxmox-file-restore returns them (VM archive root, then a directory).
const entries: FileRestoreEntry[] = [
  { filepath: b64('/root.pxar.didx/etc/hosts'), text: 'hosts', type: 'f', leaf: true, size: 220, mtime: 1793479752 },
  { filepath: b64('/root.pxar.didx/etc/ssl'), text: 'ssl', type: 'd', leaf: false, mtime: 1793479700 },
  { filepath: b64('/root.pxar.didx/etc/localtime'), text: 'localtime', type: 'l', leaf: true },
  { filepath: b64('/root.pxar.didx/etc/apk'), text: 'apk', type: 'd', leaf: false },
  { filepath: b64('/root.pxar.didx/etc/file10'), text: 'file10', type: 'f', leaf: true },
  { filepath: b64('/root.pxar.didx/etc/file9'), text: 'file9', type: 'f', leaf: true },
]

describe('file restore helpers', () => {
  it('decodes base64 paths, including UTF-8, and keeps the root', () => {
    expect(decodeFilepath('/')).toBe('/')
    expect(decodeFilepath(b64('/drive-scsi0.img.fidx/part/1/文档'))).toBe('/drive-scsi0.img.fidx/part/1/文档')
    expect(decodeFilepath('%%%')).toBe('%%%')
  })

  it('sorts directories first, then by natural name order', () => {
    expect(sortEntries(entries).map((e) => e.text)).toEqual(['apk', 'ssl', 'file9', 'file10', 'hosts', 'localtime'])
  })

  it('knows what can be opened and downloaded', () => {
    expect(isBrowsable({ type: 'd', leaf: false })).toBe(true)
    expect(isBrowsable({ type: 'f', leaf: true })).toBe(false)
    expect(isBrowsable({ type: 'v' })).toBe(true) // VM disk archive / partition
    expect(isBrowsable({ type: 'd', leaf: 1 })).toBe(false)
    expect(canDownloadEntry('f')).toBe(true)
    expect(canDownloadEntry('h')).toBe(true)
    expect(canDownloadEntry('d')).toBe(true)
    expect(canDownloadEntry('l')).toBe(false)
    expect(canDownloadEntry('v')).toBe(false)
    expect(fileTypeLabel('l')).toBe('软链接')
    expect(fileTypeLabel('x')).toBe('未知')
  })

  it('names downloads like the official browser', () => {
    expect(downloadFilename({ text: 'hosts', type: 'f' })).toBe('hosts')
    expect(downloadFilename({ text: 'etc', type: 'd' })).toBe('etc.zip')
    expect(downloadFilename({ text: 'etc', type: 'd' }, true)).toBe('etc.tar.zst')
  })

  it('builds the download URL with volume, base64 path and tar flag', () => {
    const fp = b64('/root.pxar.didx/etc')
    const url = fileRestoreDownloadUrl('pve-lab', 'pbs', 'pbs:backup/ct/200/2026-10-01T00:00:00Z', fp, true)
    const u = new URL(url, 'http://x')
    expect(u.pathname).toBe('/api2/json/nodes/pve-lab/storage/pbs/file-restore/download')
    expect(u.searchParams.get('volume')).toBe('pbs:backup/ct/200/2026-10-01T00:00:00Z')
    expect(u.searchParams.get('filepath')).toBe(fp)
    expect(u.searchParams.get('tar')).toBe('1')
    expect(new URL(fileRestoreDownloadUrl('n', 's', 'v', '/'), 'http://x').searchParams.has('tar')).toBe(false)
  })

  it('detects VM archives and keeps the breadcrumb consistent', () => {
    expect(isVmArchive('pbs:backup/vm/100/2026-10-01T00:00:00Z', 'pbs-vm')).toBe(true)
    expect(isVmArchive('pbs:backup/ct/200/2026-10-01T00:00:00Z', 'pbs-ct')).toBe(false)
    const root = { filepath: '/', text: '根目录' }
    const a = { filepath: 'YQ==', text: 'a' }
    const b = { filepath: 'Yg==', text: 'b' }
    expect(enterCrumb([root], a)).toEqual([root, a])
    expect(enterCrumb([root, a, b], a)).toEqual([root, a])
  })

  it('offers file restore for PBS backups only', () => {
    const v: StorageVolume = {
      volid: 'pbs:backup/ct/200/2026-10-01T00:00:00Z',
      content: 'backup',
      format: 'pbs-ct',
      subtype: 'lxc',
      vmid: 200,
    }
    const env = { open: () => {}, toggleProtected: () => {}, deleteBlocked: null }
    const pbs = volumeActions(v, { ...env, isPbs: true }).find((a) => a.id === 'file-restore')
    expect(pbs?.disabled).toBeFalsy()
    expect(volumeActions(v, env).some((a) => a.id === 'file-restore')).toBe(false)
  })
})
