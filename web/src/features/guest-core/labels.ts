// Chinese labels for guest states and config values.

const QMP: Record<string, string> = {
  running: '运行中',
  stopped: '已停止',
  paused: '已暂停',
  suspended: '已挂起',
  prelaunch: '准备启动',
  shutdown: '正在关机',
  inmigrate: '迁入中',
  postmigrate: '已迁出',
  'io-error': 'I/O 错误',
  'internal-error': '内部错误',
  'guest-panicked': '系统崩溃',
  watchdog: '看门狗触发',
  'restore-vm': '正在恢复',
  'save-vm': '正在保存',
  debug: '调试中',
  unknown: '未知',
}

export function qmpStatusLabel(status: string | undefined): string {
  if (!status) return '未知'
  return QMP[status] ?? status
}

const HA: Record<string, string> = {
  started: '已启动',
  stopped: '已停止',
  disabled: '已禁用',
  ignored: '已忽略',
  enabled: '已启用',
  error: '错误',
  fence: '隔离中',
  recovery: '恢复中',
  freeze: '冻结',
  migrate: '迁移中',
  relocate: '重新分配中',
  request_stop: '请求停止',
  request_start: '请求启动',
  queued: '排队中',
  starting: '启动中',
  stopping: '停止中',
}

export function haStateLabel(state: string | undefined): string {
  if (!state) return '已加入'
  return HA[state] ?? state
}

const OS: Record<string, string> = {
  l24: 'Linux 2.4',
  l26: 'Linux 6.x - 2.6',
  other: '其他',
  wxp: 'Windows XP',
  w2k: 'Windows 2000',
  w2k3: 'Windows 2003',
  w2k8: 'Windows 2008',
  wvista: 'Windows Vista',
  win7: 'Windows 7',
  win8: 'Windows 8 / 2012',
  win10: 'Windows 10 / 2016 / 2019',
  win11: 'Windows 11 / 2022 / 2025',
  solaris: 'Solaris',
  // LXC
  debian: 'Debian',
  ubuntu: 'Ubuntu',
  centos: 'CentOS',
  fedora: 'Fedora',
  opensuse: 'openSUSE',
  archlinux: 'Arch Linux',
  alpine: 'Alpine',
  gentoo: 'Gentoo',
  nixos: 'NixOS',
  devuan: 'Devuan',
  unmanaged: '未托管',
}

export function osTypeLabel(ostype: string | undefined): string {
  if (!ostype) return '—'
  return OS[ostype] ?? ostype
}
