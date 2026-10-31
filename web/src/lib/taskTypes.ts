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
  resize: ['调整磁盘大小', ''],
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
  // Backup and storage
  vzdump: ['备份', ''],
  imgcopy: ['复制镜像', ''],
  imgdel: ['删除镜像', ''],
  download: ['下载', ''],
  pbs_download: ['从 PBS 下载', ''],
  prune: ['清理备份', ''],
  unknownimgdel: ['删除未引用镜像', ''],
  // Console
  vncproxy: ['控制台', ''],
  vncshell: ['Shell', '节点 '],
  spiceproxy: ['SPICE 控制台', ''],
  spiceshell: ['SPICE Shell', ''],
  termproxy: ['终端', ''],
  // Node
  startall: ['批量启动', ''],
  stopall: ['批量停止', ''],
  suspendall: ['批量挂起', ''],
  migrateall: ['批量迁移', ''],
  aptupdate: ['更新软件包索引', ''],
  srvstart: ['启动服务', ''],
  srvstop: ['停止服务', ''],
  srvrestart: ['重启服务', ''],
  srvreload: ['重载服务', ''],
  reboot: ['重启节点', ''],
  shutdown: ['关闭节点', ''],
  diskinit: ['初始化磁盘', ''],
  wipedisk: ['擦除磁盘', ''],
  dircreate: ['创建目录存储', ''],
  dirremove: ['删除目录存储', ''],
  lvmcreate: ['创建 LVM', ''],
  lvmremove: ['删除 LVM', ''],
  lvmthincreate: ['创建 LVM-Thin', ''],
  lvmthinremove: ['删除 LVM-Thin', ''],
  zfscreate: ['创建 ZFS', ''],
  zfsremove: ['删除 ZFS', ''],
  // Cluster / HA / Ceph / ACME
  hamigrate: ['HA 迁移', ''],
  hastart: ['HA 启动', ''],
  hastop: ['HA 停止', ''],
  clustercreate: ['创建集群', ''],
  clusterjoin: ['加入集群', ''],
  acmenewcert: ['申请证书', ''],
  acmerenew: ['续期证书', ''],
  acmerevoke: ['吊销证书', ''],
  acmeregister: ['注册 ACME 账户', ''],
  acmedeactivate: ['停用 ACME 账户', ''],
  acmeupdate: ['更新 ACME 账户', ''],
  cephcreateosd: ['创建 Ceph OSD', ''],
  cephdestroyosd: ['删除 Ceph OSD', ''],
  cephcreatemon: ['创建 Ceph Monitor', ''],
  cephdestroymon: ['删除 Ceph Monitor', ''],
  cephcreatepool: ['创建 Ceph 存储池', ''],
  cephdestroypool: ['删除 Ceph 存储池', ''],
  auth_realm_sync: ['同步认证域', ''],
  reloadnetworkall: ['应用网络配置', ''],
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
