// Types for the PVE API responses used by the app. Field names follow the API
// exactly; check `pvesh usage <path> -v` on a PVE host for the schema.

/** 0/1 booleans as PVE returns them. */
export type PveBool = 0 | 1

// ------------------------------------------------------------------- auth

/** Privileges by path, e.g. cap.vms['VM.PowerMgmt'] === 1. */
export type Capabilities = Record<string, Record<string, PveBool>>

export interface TicketResponse {
  username: string
  ticket: string
  CSRFPreventionToken?: string
  cap?: Capabilities
  clustername?: string
  /** Legacy (pre PVE 7) second-factor marker. */
  NeedTFA?: PveBool
}

/** GET /access/domains (works without authentication). */
export interface AuthDomain {
  realm: string
  type: 'pam' | 'pve' | 'ad' | 'ldap' | 'openid' | string
  comment?: string
  default?: PveBool
  tfa?: string
}

// --------------------------------------------------------- cluster/resources

export type ResourceType = 'node' | 'qemu' | 'lxc' | 'storage' | 'pool' | 'sdn' | 'network' | 'openvz'
export type GuestType = 'qemu' | 'lxc'
export type GuestStatus = 'running' | 'stopped' | 'paused' | 'suspended' | 'prelaunch' | 'unknown' | (string & {})
export type NodeStatus = 'online' | 'offline' | 'unknown'

interface ResourceBase {
  /** Unique id, e.g. "qemu/100", "node/pve", "storage/pve/local". */
  id: string
  type: ResourceType
  node?: string
  status?: string
  hastate?: string
  pool?: string
  lock?: string
  tags?: string
}

export interface NodeResource extends ResourceBase {
  type: 'node'
  node: string
  status: NodeStatus
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  level?: string
  'cgroup-mode'?: number
}

export interface GuestResource extends ResourceBase {
  type: GuestType
  vmid: number
  node: string
  name?: string
  status: GuestStatus
  template?: PveBool
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  /** Host-side memory usage (PVE 9); for QEMU it can include overhead. */
  memhost?: number
  disk?: number
  maxdisk?: number
  diskread?: number
  diskwrite?: number
  netin?: number
  netout?: number
  uptime?: number
}

export interface StorageResource extends ResourceBase {
  type: 'storage'
  node: string
  storage: string
  status: 'available' | 'unknown' | (string & {})
  disk?: number
  maxdisk?: number
  content?: string
  plugintype?: string
  shared?: PveBool
}

export interface PoolResource extends ResourceBase {
  type: 'pool'
  pool: string
}

export interface NetworkResource extends ResourceBase {
  type: 'sdn' | 'network' | 'openvz'
  sdn?: string
  network?: string
  'network-type'?: string
  zone?: string
}

export type ClusterResource = NodeResource | GuestResource | StorageResource | PoolResource | NetworkResource

export function isGuest(r: ClusterResource): r is GuestResource {
  return r.type === 'qemu' || r.type === 'lxc'
}
export function isNode(r: ClusterResource): r is NodeResource {
  return r.type === 'node'
}
export function isStorage(r: ClusterResource): r is StorageResource {
  return r.type === 'storage'
}

// ------------------------------------------------------------ cluster/status

export interface ClusterStatusCluster {
  type: 'cluster'
  id: string
  name: string
  nodes: number
  quorate: PveBool
  version: number
}

export interface ClusterStatusNode {
  type: 'node'
  id: string
  name: string
  nodeid: number
  online: PveBool
  local?: PveBool
  ip?: string
  level?: string
}

export type ClusterStatusEntry = ClusterStatusCluster | ClusterStatusNode

// ------------------------------------------------------------------- nodes

/** GET /nodes */
export interface NodeListEntry {
  node: string
  status: NodeStatus
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  level?: string
  id?: string
  ssl_fingerprint?: string
}

/** GET /nodes/{node}/rrddata — one sample; all fields optional (gaps). */
export interface NodeRrdPoint {
  time: number
  cpu?: number
  maxcpu?: number
  iowait?: number
  loadavg?: number
  memused?: number
  memtotal?: number
  memavailable?: number
  swapused?: number
  swaptotal?: number
  rootused?: number
  roottotal?: number
  netin?: number
  netout?: number
}

export type RrdTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year' | 'decade'

// ------------------------------------------------------------------ version

export interface VersionInfo {
  version: string
  release: string
  repoid: string
  console?: string
}

// -------------------------------------------------------------------- tasks

/** GET /cluster/tasks (recent tasks of all nodes). */
export interface ClusterTask {
  upid: string
  node: string
  type: string
  id: string
  user: string
  starttime: number
  endtime?: number
  /** Missing while running; "OK", "WARNINGS: n" or an error message when done. */
  status?: string
  saved?: string
  tokenid?: string
}

/** GET /nodes/{node}/tasks/{upid}/status */
export interface TaskStatus {
  upid: string
  node: string
  pid: number
  pstart: number
  starttime: number
  type: string
  id: string
  user: string
  status: 'running' | 'stopped'
  exitstatus?: string
}

// ------------------------------------------------------------------ storage

/** Content types a storage can hold (storage.cfg `content`). */
export type StorageContent = 'images' | 'rootdir' | 'iso' | 'vztmpl' | 'backup' | 'snippets' | 'import'

/** GET /nodes/{node}/storage (per-node view with usage). */
export interface NodeStorage {
  storage: string
  /** Plugin type: dir, lvm, lvmthin, zfspool, nfs, cifs, pbs, rbd, cephfs, … */
  type: string
  /** Comma separated StorageContent list. */
  content: string
  active?: PveBool
  enabled?: PveBool
  shared?: PveBool
  total?: number
  used?: number
  avail?: number
  used_fraction?: number
}

// ------------------------------------------------------------------ network

/** GET /nodes/{node}/network (fields depend on the interface type). */
export interface NodeNetworkInterface {
  iface: string
  type: 'bridge' | 'bond' | 'eth' | 'alias' | 'vlan' | 'fabric' | 'OVSBridge' | 'OVSBond' | 'OVSPort' | 'OVSIntPort' | 'vnet' | 'unknown' | (string & {})
  active?: PveBool
  autostart?: PveBool
  method?: string
  method6?: string
  address?: string
  netmask?: string
  cidr?: string
  gateway?: string
  address6?: string
  cidr6?: string
  gateway6?: string
  bridge_ports?: string
  bridge_vlan_aware?: PveBool
  comments?: string
  families?: string[]
  priority?: number
}
