// Chinese descriptions of PVE task types (Proxmox.Utils.task_desc_table in
// the official UI). Owned by the tasks-logs area; extend freely.

import { parseUpid } from '@/api/tasks'

/** [label, subject prefix]: describeTask renders "<label> <prefix><id>". */
type TaskTypeDesc = readonly [label: string, subject?: string]

export const TASK_TYPES: Record<string, TaskTypeDesc> = {
  // QEMU
  qmstart: ['启动', 'VM '],
  qmstop: ['强制停止', 'VM '],
  qmshutdown: ['关机', 'VM '],
  qmreboot: ['重启', 'VM '],
  qmreset: ['重置', 'VM '],
  qmsuspend: ['休眠', 'VM '],
  qmpause: ['暂停', 'VM '],
  qmresume: ['恢复运行', 'VM '],
  qmcreate: ['创建', 'VM '],
  qmclone: ['克隆', 'VM '],
  qmdestroy: ['删除', 'VM '],
  qmigrate: ['迁移', 'VM '],
  qmsnapshot: ['创建快照', 'VM '],
  qmrollback: ['回滚快照', 'VM '],
  qmdelsnapshot: ['删除快照', 'VM '],
  qmrestore: ['恢复备份', 'VM '],
  qmtemplate: ['转换为模板', 'VM '],
  qmmove: ['移动磁盘', 'VM '],
  qmconfig: ['修改配置', 'VM '],
  qmimport: ['导入', 'VM '],
  qmreassign: ['重新分配磁盘', 'VM '],
  resize: ['调整磁盘大小', 'VM/CT '],
  // LXC
  vzstart: ['启动', 'CT '],
  vzstop: ['强制停止', 'CT '],
  vzshutdown: ['关机', 'CT '],
  vzreboot: ['重启', 'CT '],
  vzsuspend: ['挂起', 'CT '],
  vzresume: ['恢复运行', 'CT '],
  vzcreate: ['创建', 'CT '],
  vzclone: ['克隆', 'CT '],
  vzdestroy: ['删除', 'CT '],
  vzmigrate: ['迁移', 'CT '],
  vzsnapshot: ['创建快照', 'CT '],
  vzrollback: ['回滚快照', 'CT '],
  vzdelsnapshot: ['删除快照', 'CT '],
  vzrestore: ['恢复备份', 'CT '],
  vztemplate: ['转换为模板', 'CT '],
  vzmount: ['挂载', 'CT '],
  vzumount: ['卸载', 'CT '],
  move_volume: ['移动卷', 'CT '],
  pull_file: ['读取文件', 'CT '],
  push_file: ['写入文件', 'CT '],
  // Backup and storage
  vzdump: ['备份', 'VM/CT '],
  imgcopy: ['复制数据', ''],
  imgdel: ['擦除数据', ''],
  download: ['下载文件', ''],
  'pbs-download': ['文件恢复下载', 'VM/CT '],
  prune: ['清理备份', ''],
  unknownimgdel: ['删除未知客户机的镜像', ''],
  // Console
  vncproxy: ['控制台', 'VM/CT '],
  vncshell: ['Shell', ''],
  spiceproxy: ['SPICE 控制台', 'VM/CT '],
  spiceshell: ['SPICE Shell', ''],
  termproxy: ['终端（xterm.js）', ''],
  // Node
  startall: ['批量启动', ''],
  stopall: ['批量关机', ''],
  suspendall: ['批量休眠', ''],
  migrateall: ['批量迁移', ''],
  'bulk-start': ['批量启动', ''],
  'bulk-shutdown': ['批量关机', ''],
  'bulk-suspend': ['批量休眠', ''],
  'bulk-migrate': ['批量迁移', ''],
  aptupdate: ['更新软件包索引', ''],
  srvstart: ['启动服务', ''],
  srvstop: ['停止服务', ''],
  srvrestart: ['重启服务', ''],
  srvreload: ['重载服务', ''],
  reboot: ['重启节点', ''],
  shutdown: ['关闭节点', ''],
  diskinit: ['初始化磁盘（GPT）', ''],
  wipedisk: ['擦除磁盘', ''],
  dircreate: ['创建目录存储', ''],
  dirremove: ['删除目录存储', ''],
  lvmcreate: ['创建 LVM 存储', ''],
  lvmremove: ['删除卷组', ''],
  lvmthincreate: ['创建 LVM-Thin 存储', ''],
  lvmthinremove: ['删除 Thin 池', ''],
  zfscreate: ['创建 ZFS 存储', ''],
  zfsremove: ['删除 ZFS 池', ''],
  reloadnetworkall: ['应用网络配置（所有节点）', ''],
  // Cluster / HA
  hamigrate: ['HA 迁移', ''],
  hastart: ['HA 启动', ''],
  hastop: ['HA 停止', ''],
  hashutdown: ['HA 关机', ''],
  clustercreate: ['创建集群', ''],
  clusterjoin: ['加入集群', ''],
  'auth-realm-sync': ['同步认证域', ''],
  'auth-realm-sync-test': ['预览认证域同步', ''],
  // ACME
  acmenewcert: ['申请证书', ''],
  acmerenew: ['续期证书', ''],
  acmerevoke: ['吊销证书', ''],
  acmeregister: ['注册 ACME 账户', ''],
  acmedeactivate: ['停用 ACME 账户', ''],
  acmeupdate: ['更新 ACME 账户', ''],
  acmerefresh: ['刷新 ACME 账户', ''],
  // Ceph
  cephcreateosd: ['创建 Ceph OSD', ''],
  cephdestroyosd: ['删除 Ceph OSD', ''],
  cephcreatemon: ['创建 Ceph Monitor', ''],
  cephdestroymon: ['删除 Ceph Monitor', ''],
  cephcreatemgr: ['创建 Ceph Manager', ''],
  cephdestroymgr: ['删除 Ceph Manager', ''],
  cephcreatemds: ['创建 Ceph MDS', ''],
  cephdestroymds: ['删除 Ceph MDS', ''],
  cephcreatepool: ['创建 Ceph 存储池', ''],
  cephdestroypool: ['删除 Ceph 存储池', ''],
  cephsetpool: ['修改 Ceph 存储池', ''],
  cephfscreate: ['创建 CephFS', ''],
  cephdestroyfs: ['删除 CephFS', ''],
  cephsetflags: ['修改 Ceph 全局标志', ''],
}

/** Groups for the task type filter, in display order. Types not listed land in "其他". */
export const TASK_TYPE_GROUPS: readonly { label: string; types: readonly string[] }[] = [
  {
    label: '虚拟机',
    types: [
      'qmstart', 'qmshutdown', 'qmreboot', 'qmstop', 'qmreset', 'qmsuspend', 'qmpause', 'qmresume', 'qmcreate',
      'qmclone', 'qmdestroy', 'qmigrate', 'qmsnapshot', 'qmrollback', 'qmdelsnapshot', 'qmrestore', 'qmtemplate',
      'qmmove', 'qmconfig', 'qmimport', 'qmreassign', 'resize',
    ],
  },
  {
    label: '容器',
    types: [
      'vzstart', 'vzshutdown', 'vzreboot', 'vzstop', 'vzsuspend', 'vzresume', 'vzcreate', 'vzclone', 'vzdestroy',
      'vzmigrate', 'vzsnapshot', 'vzrollback', 'vzdelsnapshot', 'vzrestore', 'vztemplate', 'vzmount', 'vzumount',
      'move_volume', 'pull_file', 'push_file',
    ],
  },
  { label: '备份与存储', types: ['vzdump', 'download', 'pbs-download', 'prune', 'imgcopy', 'imgdel', 'unknownimgdel'] },
  { label: '控制台', types: ['vncproxy', 'vncshell', 'termproxy', 'spiceproxy', 'spiceshell'] },
  {
    label: '节点',
    types: [
      'aptupdate', 'srvstart', 'srvstop', 'srvrestart', 'srvreload', 'startall', 'stopall', 'suspendall', 'migrateall',
      'bulk-start', 'bulk-shutdown', 'bulk-suspend', 'bulk-migrate', 'reboot', 'shutdown', 'reloadnetworkall',
    ],
  },
  {
    label: '磁盘',
    types: ['diskinit', 'wipedisk', 'dircreate', 'dirremove', 'lvmcreate', 'lvmremove', 'lvmthincreate', 'lvmthinremove', 'zfscreate', 'zfsremove'],
  },
  {
    label: '集群与 HA',
    types: ['hamigrate', 'hastart', 'hastop', 'hashutdown', 'clustercreate', 'clusterjoin', 'auth-realm-sync', 'auth-realm-sync-test'],
  },
  { label: '证书', types: ['acmenewcert', 'acmerenew', 'acmerevoke', 'acmeregister', 'acmedeactivate', 'acmeupdate', 'acmerefresh'] },
  {
    label: 'Ceph',
    types: [
      'cephcreateosd', 'cephdestroyosd', 'cephcreatemon', 'cephdestroymon', 'cephcreatemgr', 'cephdestroymgr',
      'cephcreatemds', 'cephdestroymds', 'cephcreatepool', 'cephdestroypool', 'cephsetpool', 'cephfscreate',
      'cephdestroyfs', 'cephsetflags',
    ],
  },
]

/**
 * Label for a type in the type filter: group-specific types read
 * unambiguously ("启动" is listed under both 虚拟机 and 容器, so the list
 * shows "启动（VM）").
 */
export function taskTypeOptionLabel(type: string): string {
  const desc = TASK_TYPES[type]
  if (!desc) return type
  const subject = desc[1]?.trim()
  return subject ? `${desc[0]}（${subject}）` : desc[0]
}

/** "qmstart" → "启动"; unknown types are returned as-is. */
export function taskTypeLabel(type: string): string {
  return TASK_TYPES[type]?.[0] ?? type
}

/** { type: 'qmstart', id: '100' } → "启动 VM 100". */
export function describeTask(task: { type: string; id?: string | null }): string {
  const desc = TASK_TYPES[task.type]
  if (!desc) return task.id ? `${task.type} ${task.id}` : task.type
  const [label, prefix = ''] = desc
  return task.id ? `${label} ${prefix}${task.id}` : label
}

/** Description straight from a UPID; falls back to the raw string. */
export function describeUpid(upid: string): string {
  const parsed = parseUpid(upid)
  return parsed ? describeTask(parsed) : upid
}
