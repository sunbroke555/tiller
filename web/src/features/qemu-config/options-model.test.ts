import { describe, expect, it } from 'vitest'

import { splitPending } from './model'
import { optionRows, optionSummary } from './options-model'

describe('optionSummary', () => {
  it('renders booleans with their defaults', () => {
    expect(optionSummary('onboot', {})).toBe('否')
    expect(optionSummary('onboot', { onboot: '1' })).toBe('是')
    expect(optionSummary('acpi', {})).toBe('是')
    expect(optionSummary('kvm', { kvm: '0' })).toBe('否')
  })

  it('renders structured options', () => {
    expect(optionSummary('startup', { startup: 'order=2,up=30' })).toBe('顺序 2 · 启动延迟 30 秒')
    expect(optionSummary('startup', {})).toBe('顺序任意')
    expect(optionSummary('ostype', { ostype: 'l26' })).toContain('Linux')
    expect(optionSummary('boot', { boot: 'order=scsi0;net0', scsi0: 'x', net0: 'virtio' })).toBe('scsi0 → net0')
    expect(optionSummary('boot', { boot: ' ' })).toBe('（未选择启动设备）')
    expect(optionSummary('hotplug', {})).toBe('磁盘、网络、USB')
    expect(optionSummary('hotplug', { hotplug: '0' })).toBe('已禁用')
    expect(optionSummary('agent', { agent: '1,fstrim_cloned_disks=1' })).toBe('启用 · 迁移后 fstrim')
    expect(optionSummary('agent', {})).toBe('默认（禁用）')
    expect(optionSummary('localtime', {})).toBe('默认（Windows 启用）')
    expect(optionSummary('keyboard', { keyboard: 'de' })).toBe('德语 (de)')
    expect(optionSummary('spice_enhancements', { spice_enhancements: 'foldersharing=1,videostreaming=all' })).toBe('文件夹共享 · 视频流 all')
    expect(optionSummary('amd-sev', { 'amd-sev': 'snp' })).toBe('AMD SEV-SNP (snp)')
    expect(optionSummary('name', {}, 'fallback')).toBe('fallback')
  })
})

describe('optionRows', () => {
  it('marks pending options', () => {
    const rows = optionRows(
      splitPending([
        { key: 'name', value: 'a', pending: 'b' },
        { key: 'onboot', value: 1, delete: 1 },
        { key: 'bootdisk', value: 'scsi0', delete: 1 },
      ]),
    )
    const by = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(by.name).toMatchObject({ status: 'changed', summary: 'a', pendingSummary: 'b' })
    expect(by.onboot).toMatchObject({ status: 'changed', summary: '是', pendingSummary: '否' })
    expect(by.boot!.status).toBe('changed') // bootdisk belongs to the boot row
    expect(by.tablet!.status).toBe('unchanged')
  })
})
