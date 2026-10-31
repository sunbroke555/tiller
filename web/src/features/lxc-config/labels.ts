// Display names and value formatting of container config keys (pending list,
// confirm dialogs).

import { splitKey } from './model'

const LABELS: Record<string, string> = {
  memory: '内存',
  swap: '交换分区',
  cores: '核心数',
  cpulimit: 'CPU 限制',
  cpuunits: 'CPU 权重',
  rootfs: '根磁盘',
  hostname: '主机名',
  searchdomain: 'DNS 域',
  nameserver: 'DNS 服务器',
  onboot: '开机自启',
  startup: '启动/关机顺序',
  ostype: '系统类型',
  arch: '架构',
  console: '控制台设备',
  tty: 'TTY 数量',
  cmode: '控制台模式',
  protection: '保护',
  unprivileged: '非特权容器',
  features: '特性',
  hookscript: '钩子脚本',
  timezone: '时区',
  entrypoint: '入口命令',
  env: '环境变量',
  description: '备注',
  tags: '标签',
}

export function keyLabel(key: string): string {
  if (LABELS[key]) return LABELS[key]
  const k = splitKey(key)
  if (k?.prefix === 'mp') return `挂载点 ${key}`
  if (k?.prefix === 'unused') return `未使用的磁盘 ${k.index}`
  if (k?.prefix === 'dev') return `设备 ${key}`
  if (k?.prefix === 'net') return `网卡 ${key}`
  return key
}

const BOOL_KEYS = new Set(['onboot', 'console', 'protection', 'unprivileged'])

/** Short value for the pending list. */
export function formatKeyValue(key: string, value: string | undefined): string {
  if (value === undefined || value === '') return '（未设置）'
  if (key === 'memory' || key === 'swap') return `${value} MiB`
  if (BOOL_KEYS.has(key)) return value === '1' ? '是' : '否'
  if (key === 'cores') return `${value} 核`
  if (key === 'env') return value.split('\0').filter(Boolean).join(' ')
  return value
}

/** Which tab shows a key's pending change. */
export type ConfigTab = 'resources' | 'network' | 'dns' | 'options'

const RESOURCE_KEYS = new Set(['memory', 'swap', 'cores', 'cpulimit', 'cpuunits', 'rootfs'])
const DNS_KEYS = new Set(['hostname', 'searchdomain', 'nameserver'])
const NOT_OPTIONS = new Set(['description', 'tags', 'lock', 'template', 'lxc'])

export function tabOfKey(key: string): ConfigTab | null {
  if (RESOURCE_KEYS.has(key)) return 'resources'
  const k = splitKey(key)
  if (k && (k.prefix === 'mp' || k.prefix === 'unused' || k.prefix === 'dev')) return 'resources'
  if (k?.prefix === 'net') return 'network'
  if (DNS_KEYS.has(key)) return 'dns'
  if (NOT_OPTIONS.has(key)) return null
  return 'options'
}
