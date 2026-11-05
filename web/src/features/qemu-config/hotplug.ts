// Conservative eligibility, based on PVE QemuServer::vmconfig_hotplug_pending.
// PVE has no dry-run API: eligible means retryable, never guaranteed success.
// Always inspect the active config, not pending hotplug/machine/NUMA settings.
import type { Params } from '@/api/client'
import { parseDrive, parseQemuNet, tryParsePropertyString } from '@/lib/propstring'
import { parseMemory, type PendingState } from './model'
import { parseHotplug } from './params'

export interface OnlineChange {
  key: string
  mode: 'online' | 'restart' | 'manual'
  reason: string
  privilege?: string
}

export function classifyOnlineChange(state: PendingState, key: string, machine?: string): OnlineChange {
  const current = state.current
  const before = current[key]
  const after = state.next[key]
  const features = parseHotplug(current.hotplug)
  const online = (privilege: string, reason = '配置允许在线应用，仍需 PVE 和客户机确认'): OnlineChange =>
    ({ key, mode: 'online', reason, privilege: `VM.Config.${privilege}` })
  const restart = (reason: string): OnlineChange => ({ key, mode: 'restart', reason })
  const manual = (reason: string): OnlineChange => ({ key, mode: 'manual', reason })
  if (!state.pending.has(key)) return manual('没有待生效的更改')
  // Do not replay removals in bulk: pending.delete=2 can destroy a volume.
  if (state.deleting.has(key)) return manual('移除操作需逐项处理，或关机后应用')
  if (key === 'cpulimit' || key === 'cpuunits') return online('CPU', 'CPU 配额和权重可在线调整')
  if (key === 'shares') return online('Memory', '内存权重可在线调整')
  if (key === 'vcpus') {
    if (!features.includes('cpu')) return restart('当前未启用 CPU 热插拔')
    if (Number(after) > Number(current.cores ?? 1) * Number(current.sockets ?? 1)) return restart('超出当前 CPU 拓扑的最大核心数')
    return online('CPU')
  }
  if (key === 'memory') {
    if (!features.includes('memory')) return restart('当前未启用内存热插拔')
    if (current.numa !== '1') return restart('内存热插拔需要启动时已启用 NUMA')
    if (parseMemory(after) < 1024) return manual('内存热插拔的基础内存限制需由 PVE 检查，建议关机后应用')
    return online('Memory')
  }
  if (key === 'balloon') {
    return (before === '0') !== (after === '0')
      ? restart('启用或禁用气球设备需要关机后启动') : online('Memory')
  }
  if (/^net\d+$/.test(key)) {
    const a = parseQemuNet(before)
    const b = parseQemuNet(after)
    if (!b) return manual('无法识别网卡配置')
    const inPlace = a && a.model === b.model && a.macaddr === b.macaddr && a.options.bridge && b.options.bridge
      && ['queues', 'mtu'].every((k) => a.options[k] === b.options[k])
    if (inPlace || features.includes('network')) return online('Network', '可尝试在线更新；网络连接可能短暂中断')
    return restart('此网卡变更需要网络热插拔，当前未启用')
  }
  if (/^(scsi|virtio|ide|sata)\d+$/.test(key)) {
    const a = parseDrive(before)
    const b = parseDrive(after)
    if (/cloudinit/.test(a.file ?? '') || /cloudinit/.test(b.file ?? '')) return manual('请在 Cloud-Init 页面管理镜像更新')
    const cdrom = b.media === 'cdrom'
    if (before && (a.media ?? 'disk') !== (b.media ?? 'disk')) return restart('更改设备介质类型需要关机')
    if (before && cdrom) return online('CDROM', '已有光驱可以在线更换介质')
    if (before && a.file === b.file) {
      const fixed = ['aio', 'discard', 'iothread', 'queues', 'product', 'cache', 'ssd', 'vendor', 'ro']
      if (fixed.some((k) => a[k] !== b[k])) return restart('磁盘缓存、IO 线程等设备参数需要关机后应用')
      // Only offer known live metadata/throttle changes; avoid promising that
      // arbitrary drive properties actually change the running device.
      const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k])
      if (changed.every((k) => /^(mbps|iops|bps)(_|$)/.test(k) || ['backup', 'replicate', 'snapshot'].includes(k))) return online('Disk')
      return manual('无法确认这些磁盘参数可在线应用')
    }
    if (/^(ide|sata)/.test(key)) return restart('IDE / SATA 设备的添加或替换需要关机')
    return features.includes('disk') ? online(cdrom ? 'CDROM' : 'Disk', '设备热插拔可能短暂中断磁盘访问') : restart('当前未启用磁盘热插拔')
  }
  if (key === 'tablet') return features.includes('usb') ? online('HWType') : restart('当前未启用 USB 热插拔')
  if (/^usb\d+$/.test(key)) {
    if (!features.includes('usb')) return restart('当前未启用 USB 热插拔')
    const version = /-(\d+)\.(\d+)/.exec(machine ?? '')
    if (!version) return manual('无法确定正在运行的机器版本')
    if (Number(version[1]) < 7 || Number(version[1]) === 7 && Number(version[2]) < 1) return restart('USB 热插拔需要机器版本 7.1 或更新')
    if (!['l26', 'win8', 'win10', 'win11'].includes(current.ostype ?? '')) return restart('当前操作系统类型不支持 PVE 的 USB 热插拔')
    // Passthrough permissions depend on host device / resource mapping; PVE
    // still checks those separately, just as in the USB editor.
    return online('HWType')
  }
  if (key === 'hotplug') {
    return [...features, ...parseHotplug(after)].some((f) => f === 'cpu' || f === 'memory')
      ? restart('涉及 CPU / 内存热插拔开关，需要关机后启动') : online('Options')
  }
  if (key === 'agent') {
    const a = tryParsePropertyString(before, 'enabled')
    const b = tryParsePropertyString(after, 'enabled')
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    if (before && [...keys].every((k) => k === 'fstrim_cloned_disks' || a[k] === b[k])) return online('Options')
    return restart('Guest Agent 设备的启用、禁用或类型变更需要关机后启动')
  }
  if (['name', 'onboot', 'startup', 'protection', 'vmstatestorage'].includes(key)) return online('Options')
  if (['cores', 'sockets', 'cpu', 'numa', 'bios', 'machine', 'arch', 'scsihw', 'vga', 'efidisk0', 'tpmstate0', 'acpi', 'kvm', 'ostype', 'boot', 'bootdisk', 'smbios1', 'localtime', 'startdate', 'keyboard', 'freeze', 'amd-sev', 'intel-tdx'].includes(key)
    || /^(hostpci|serial|audio|rng|virtiofs|numa)\d+$/.test(key)) return restart('此配置需要关机后重新启动才能应用')
  return manual('暂无法确认是否支持在线应用，可在关机后应用')
}

/** Re-submit exact pending values. No revert, force, deletion or next-only dependency. */
export function onlineApplyParams(state: PendingState, changes: readonly OnlineChange[], can: (priv: string) => boolean): Params | null {
  if (!state.digest || state.current.lock) return null
  const params: Params = { digest: state.digest }
  for (const change of changes) {
    if (change.mode === 'online' && change.privilege && can(change.privilege)
      && state.pending.has(change.key) && !state.deleting.has(change.key) && state.next[change.key] !== undefined) {
      params[change.key] = state.next[change.key]
    }
  }
  return Object.keys(params).length > 1 ? params : null
}

/** Absence of a pending marker alone is insufficient (another user may revert). */
export function verifiedOnlineKeys(params: Params, after: PendingState): string[] {
  return Object.keys(params).filter((key) => key !== 'digest' && !after.pending.has(key) && after.current[key] === String(params[key]))
}
