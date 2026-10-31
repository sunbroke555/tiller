// Rows of the VM options tab and their one-line summaries (official
// PVE.qemu.Options renderers, in Chinese). Pure; tested in options-model.test.ts.

import { tryParsePropertyString } from '@/lib/propstring'

import { KEYMAPS, OS_TYPE_LABEL } from './constants'
import type { Config, HwRowStatus, PendingState } from './model'
import { agentFormFrom, bootDevices, parseHotplug, parseSmbios, sevFormFrom, tdxFormFrom } from './params'

export type OptionKey =
  | 'name'
  | 'onboot'
  | 'startup'
  | 'ostype'
  | 'boot'
  | 'tablet'
  | 'hotplug'
  | 'acpi'
  | 'kvm'
  | 'freeze'
  | 'localtime'
  | 'startdate'
  | 'smbios1'
  | 'agent'
  | 'protection'
  | 'spice_enhancements'
  | 'vmstatestorage'
  | 'keyboard'
  | 'amd-sev'
  | 'intel-tdx'
  | 'hookscript'

export interface OptionDef {
  key: OptionKey
  title: string
  /** Extra keys covered by the row (revert sends all). */
  keys?: string[]
  /** Boolean option edited with an inline switch; value when unset. */
  toggle?: { default: boolean }
  group: 'general' | 'boot' | 'hardware' | 'advanced'
}

export const OPTION_GROUP_LABEL: Record<OptionDef['group'], string> = {
  general: '常规',
  boot: '启动',
  hardware: '虚拟硬件行为',
  advanced: '高级',
}

export const OPTION_DEFS: OptionDef[] = [
  { key: 'name', title: '名称', group: 'general' },
  { key: 'ostype', title: '操作系统类型', group: 'general' },
  { key: 'protection', title: '保护', toggle: { default: false }, group: 'general' },
  { key: 'agent', title: 'QEMU Guest Agent', group: 'general' },
  { key: 'onboot', title: '开机自启', toggle: { default: false }, group: 'boot' },
  { key: 'startup', title: '启动/关机顺序', group: 'boot' },
  { key: 'boot', title: '启动顺序', keys: ['boot', 'bootdisk'], group: 'boot' },
  { key: 'freeze', title: '启动时冻结 CPU', toggle: { default: false }, group: 'boot' },
  { key: 'tablet', title: '使用平板指针', toggle: { default: true }, group: 'hardware' },
  { key: 'hotplug', title: '热插拔', group: 'hardware' },
  { key: 'acpi', title: 'ACPI 支持', toggle: { default: true }, group: 'hardware' },
  { key: 'kvm', title: 'KVM 硬件虚拟化', toggle: { default: true }, group: 'hardware' },
  { key: 'localtime', title: 'RTC 使用本地时间', group: 'hardware' },
  { key: 'startdate', title: 'RTC 起始日期', group: 'hardware' },
  { key: 'keyboard', title: 'VNC 键盘布局', group: 'hardware' },
  { key: 'smbios1', title: 'SMBIOS 设置 (type1)', group: 'advanced' },
  { key: 'spice_enhancements', title: 'SPICE 增强', group: 'advanced' },
  { key: 'vmstatestorage', title: 'VM 状态存储', group: 'advanced' },
  { key: 'amd-sev', title: 'AMD SEV', group: 'advanced' },
  { key: 'intel-tdx', title: 'Intel TDX', group: 'advanced' },
  { key: 'hookscript', title: '钩子脚本', group: 'advanced' },
]

const yesNo = (v: boolean) => (v ? '是' : '否')

/** Summary of an option for a config; `vmName` is the fallback for an unset name. */
export function optionSummary(key: OptionKey, cfg: Config, vmName?: string): string {
  const v = cfg[key]
  switch (key) {
    case 'name':
      return v ?? vmName ?? '—'
    case 'onboot':
    case 'freeze':
    case 'protection':
      return yesNo(v === '1')
    case 'tablet':
    case 'acpi':
    case 'kvm':
      return yesNo(v !== '0')
    case 'startup': {
      if (!v) return '顺序任意'
      const s = tryParsePropertyString(v, 'order')
      return [
        `顺序 ${s.order ?? '任意'}`,
        s.up !== undefined ? `启动延迟 ${s.up} 秒` : null,
        s.down !== undefined ? `关机超时 ${s.down} 秒` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    case 'ostype':
      return v ? (OS_TYPE_LABEL[v] ?? v) : '其他（默认）'
    case 'boot': {
      if (v !== undefined && /^\s*$/.test(v)) return '（未选择启动设备）'
      const list = bootDevices(cfg).filter((d) => d.enabled)
      return list.length ? list.map((d) => d.key).join(' → ') : '（未选择启动设备）'
    }
    case 'hotplug': {
      const list = parseHotplug(v)
      if (list.length === 0) return '已禁用'
      const label: Record<string, string> = { disk: '磁盘', network: '网络', usb: 'USB', memory: '内存', cpu: 'CPU', cloudinit: 'Cloud-Init' }
      return list.map((f) => label[f] ?? f).join('、')
    }
    case 'localtime':
      return v === undefined ? '默认（Windows 启用）' : yesNo(v === '1')
    case 'startdate':
      return v ?? 'now（当前时间）'
    case 'keyboard':
      return v ? `${KEYMAPS[v] ?? v} (${v})` : '默认'
    case 'smbios1': {
      if (!v) return '—'
      const s = parseSmbios(v)
      return [s.uuid && `UUID ${s.uuid}`, s.manufacturer, s.product, s.serial && `序列号 ${s.serial}`].filter(Boolean).join(' · ') || v
    }
    case 'agent': {
      if (!v) return '默认（禁用）'
      const a = agentFormFrom(v)
      if (!a.enabled) return '禁用'
      return [
        '启用',
        a.fstrim && '迁移后 fstrim',
        !a.freezeFs && '不冻结文件系统',
        a.type && a.type !== 'virtio' && `类型 ${a.type.toUpperCase()}`,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    case 'spice_enhancements': {
      const s = tryParsePropertyString(v)
      const out = [
        s.foldersharing === '1' && '文件夹共享',
        s.videostreaming && s.videostreaming !== 'off' && `视频流 ${s.videostreaming}`,
      ].filter(Boolean)
      return out.length ? out.join(' · ') : '无'
    }
    case 'vmstatestorage':
      return v ?? '自动'
    case 'amd-sev': {
      if (!v) return '默认（禁用）'
      const s = sevFormFrom(v)
      const name = s.type === 'es' ? 'AMD SEV-ES' : s.type === 'snp' ? 'AMD SEV-SNP' : 'AMD SEV'
      return `${name} (${v})`
    }
    case 'intel-tdx':
      return v && tdxFormFrom(v).enabled ? `Intel TDX (${v})` : '默认（禁用）'
    case 'hookscript':
      return v ?? '无'
  }
}

export interface OptionRow extends OptionDef {
  summary: string
  pendingSummary?: string
  status: HwRowStatus
}

export function optionRows(state: PendingState, vmName?: string): OptionRow[] {
  return OPTION_DEFS.map((def) => {
    const keys = def.keys ?? [def.key]
    const changed = keys.some((k) => state.pending.has(k))
    const summary = optionSummary(def.key, state.current, vmName)
    const after = changed ? optionSummary(def.key, state.next, vmName) : undefined
    return {
      ...def,
      summary,
      pendingSummary: after !== summary ? after : undefined,
      status: changed ? 'changed' : 'unchanged',
    }
  })
}

/** SPICE options only matter with a SPICE display (qxl*). */
export function hasSpiceDisplay(cfg: Config): boolean {
  const type = tryParsePropertyString(cfg.vga, 'type').type
  return !!type && /^qxl\d?$/.test(type)
}

