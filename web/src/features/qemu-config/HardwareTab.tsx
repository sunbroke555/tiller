import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  Archive,
  Binary,
  Cable,
  Cloud,
  CloudDownload,
  Cpu,
  Database,
  Dices,
  Disc3,
  FolderSymlink,
  HardDrive,
  KeyRound,
  Layers,
  MemoryStick,
  Microchip,
  Monitor,
  Moon,
  Move,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Scaling,
  Server,
  ShieldCheck,
  Trash2,
  Unplug,
  Usb,
  Volume2,
  type LucideIcon,
} from 'lucide-react'

import { useQemuPending, writeQemuConfig } from '@/api/qemu-config'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import type { GuestTabProps } from '@/features/guest/types'
import { parseDrive, stringifyPropertyString } from '@/lib/propstring'
import { guestPath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { HW_MAX } from './constants'
import {
  QemuConfigProvider,
  guestInvalidation,
  useDialogHost,
  useQemuConfig,
  useQemuConfigValue,
  useRevert,
  type DialogRenderProps,
} from './context'
import { AudioDialog, NetworkDialog, PciDialog, RngDialog, SerialDialog, UsbDialog, VirtiofsDialog } from './editors/devices'
import {
  CdromDialog,
  CloudinitDriveDialog,
  DiskDialog,
  EfiDiskDialog,
  MoveDiskDialog,
  ReassignDialog,
  ResizeDialog,
  TpmDialog,
} from './editors/disks'
import { ArchDialog, BiosDialog, DisplayDialog, MachineDialog, MemoryDialog, ProcessorDialog, ScsiHwDialog } from './editors/system'
import {
  HW_SECTION_LABEL,
  countKeys,
  hardwareRows,
  hasCloudinitDrive,
  maxUsbCount,
  splitPending,
  type HwKind,
  type HwRow,
  type HwSection,
} from './model'
import { ConfigRow, ConfigSection, ConfigSkeleton, PendingBanner, type RowAction } from './ui'

const HW_ICON: Record<HwKind, LucideIcon> = {
  arch: Layers,
  memory: MemoryStick,
  processors: Cpu,
  bios: Binary,
  display: Monitor,
  machine: Server,
  scsihw: Database,
  disk: HardDrive,
  cdrom: Disc3,
  cloudinit: Cloud,
  efidisk: ShieldCheck,
  tpmstate: KeyRound,
  unused: Archive,
  vmstate: Moon,
  net: Network,
  usb: Usb,
  hostpci: Microchip,
  serial: Cable,
  audio: Volume2,
  rng: Dices,
  virtiofs: FolderSymlink,
}

/** /guest/:node/qemu/:vmid/hardware — every device of the VM, pending changes and revert. */
export default function HardwareTab({ node, vmid, guest }: GuestTabProps) {
  const pending = useQemuPending(node, vmid)
  const state = useMemo(() => splitPending(pending.data), [pending.data])
  const ctx = useQemuConfigValue(node, vmid, guest, state)

  if (pending.isPending) return <ConfigSkeleton />
  if (pending.isError && !pending.data) {
    return (
      <GlassCard>
        <EmptyState
          icon={HardDrive}
          title="无法加载硬件配置"
          description={pending.error.message}
          action={
            <Button variant="outline" onClick={() => void pending.refetch()}>
              重试
            </Button>
          }
        />
      </GlassCard>
    )
  }
  return (
    <QemuConfigProvider value={ctx}>
      <HardwareView />
    </QemuConfigProvider>
  )
}

const SECTIONS: HwSection[] = ['system', 'storage', 'network', 'devices']

function HardwareView() {
  const ctx = useQemuConfig()
  const { state, node, vmid, guest, running, isRoot, can } = ctx
  const navigate = useNavigate()
  const { show, host } = useDialogHost()
  const revert = useRevert()
  const rows = useMemo(() => hardwareRows(state), [state])
  const pendingRows = rows.filter((r) => r.status !== 'unchanged')

  const open = (render: (p: DialogRenderProps) => ReactNode) => show(render)

  const editorFor = (row: HwRow): ((p: DialogRenderProps) => ReactNode) | null => {
    switch (row.kind) {
      case 'memory':
        return can('VM.Config.Memory') ? (p) => <MemoryDialog {...p} /> : null
      case 'processors':
        return can('VM.Config.CPU') || can('VM.Config.HWType') ? (p) => <ProcessorDialog {...p} /> : null
      case 'bios':
        return can('VM.Config.Options') ? (p) => <BiosDialog {...p} /> : null
      case 'display':
        return can('VM.Config.HWType') ? (p) => <DisplayDialog {...p} /> : null
      case 'machine':
        return can('VM.Config.HWType') ? (p) => <MachineDialog {...p} /> : null
      case 'scsihw':
        return can('VM.Config.Options') ? (p) => <ScsiHwDialog {...p} /> : null
      case 'arch':
        return isRoot ? (p) => <ArchDialog {...p} /> : null
      case 'disk':
        return can('VM.Config.Disk') ? (p) => <DiskDialog {...p} mode="edit" confid={row.key} /> : null
      case 'unused':
        return can('VM.Config.Disk') ? (p) => <DiskDialog {...p} mode="unused" confid={row.key} /> : null
      case 'cdrom':
        return can('VM.Config.CDROM') ? (p) => <CdromDialog {...p} confid={row.key} /> : null
      case 'net':
        return can('VM.Config.Network') ? (p) => <NetworkDialog {...p} confid={row.key} /> : null
      case 'usb':
        return (p) => <UsbDialog {...p} confid={row.key} />
      case 'hostpci':
        return (p) => <PciDialog {...p} confid={row.key} />
      case 'serial':
        return can('VM.Config.HWType') ? (p) => <SerialDialog {...p} confid={row.key} /> : null
      case 'audio':
        return can('VM.Config.HWType') ? (p) => <AudioDialog {...p} confid={row.key} /> : null
      case 'rng':
        return (p) => <RngDialog {...p} confid={row.key} />
      case 'virtiofs':
        return (p) => <VirtiofsDialog {...p} confid={row.key} />
      default:
        return null
    }
  }

  const removeRow = (row: HwRow) => {
    const usedDisk = row.kind === 'disk'
    const detach = usedDisk
    const unused = row.kind === 'unused'
    // Like the official UI: deleting volumes, or detaching while running, runs as a task.
    const async = unused || (usedDisk && running)
    const value = state.next[row.key] ?? state.current[row.key] ?? ''
    open((p) => (
      <ConfirmDialog
        {...p}
        destructive
        title={detach ? `分离 ${row.title}？` : `删除 ${row.title}？`}
        description={
          detach
            ? '磁盘会从虚拟机上分离，变成“未使用的磁盘”，数据仍然保留。'
            : unused
              ? `卷 ${value} 会被永久删除，其中的数据无法恢复。`
              : row.kind === 'vmstate'
                ? '保存的休眠状态会被永久删除，虚拟机将无法从休眠中恢复。'
                : row.kind === 'cloudinit'
                  ? 'Cloud-Init 驱动器会被删除，客户机将不再收到 Cloud-Init 配置。'
                  : '这个设备会从虚拟机上移除。运行中无法热拔的设备会在重启后移除。'
        }
        typeToConfirm={unused ? row.key : undefined}
        confirmLabel={detach ? '分离' : '删除'}
        onConfirm={() =>
          runTask(writeQemuConfig(node, vmid, { delete: row.key }, { async }), {
            title: `${detach ? '分离' : '删除'} ${row.title}`,
            invalidate: guestInvalidation(node, vmid),
            syncSuccessMessage: `${row.title} 已${detach ? '分离' : '删除'}`,
          })
        }
      />
    ))
  }

  const enrollCert = (row: HwRow) => {
    const drive = parseDrive(state.next[row.key])
    open((p) => (
      <ConfirmDialog
        {...p}
        title="注册新版微软证书？"
        description={
          <span className="grid gap-2">
            <span>注册微软 UEFI 2023 证书，安全启动更新需要它，常见 Linux 发行版的安全启动更新也需要。</span>
            <span>
              使用 BitLocker 的 Windows：请先对每个加密分区在 PowerShell 里运行
              <code className="mx-1 rounded bg-secondary px-1 py-0.5 font-mono text-xs">manage-bde -protectors -disable C:</code>
              ，否则下次启动会要求输入 BitLocker 恢复密钥。
            </span>
          </span>
        }
        confirmLabel="注册"
        onConfirm={() =>
          runTask(
            writeQemuConfig(node, vmid, { [row.key]: stringifyPropertyString({ ...drive, 'ms-cert': '2023k' }, 'file') }, { async: true }),
            { title: '注册 EFI 微软 2023 证书', invalidate: guestInvalidation(node, vmid) },
          )
        }
      />
    ))
  }

  const actionsFor = (row: HwRow): RowAction[] => {
    const out: RowAction[] = []
    const pending = row.status !== 'unchanged'
    const removed = row.status === 'removed'
    const editor = editorFor(row)
    const diskCap = can('VM.Config.Disk')
    if (editor && !removed) out.push({ id: 'edit', label: row.kind === 'unused' ? '挂载' : '编辑', icon: Pencil, onSelect: () => open(editor) })
    const isUsedDisk = row.kind === 'disk'
    const isDisk = isUsedDisk || row.kind === 'unused'
    const movable = isDisk || row.kind === 'efidisk' || (row.kind === 'tpmstate' && !running)
    if (diskCap && !removed && (isUsedDisk || movable)) {
      const why = pending ? '有未生效的更改' : false
      if (isUsedDisk) out.push({ id: 'resize', label: '扩容', icon: Scaling, disabled: why, onSelect: () => open((p) => <ResizeDialog {...p} confid={row.key} />), separated: out.length > 0 })
      if (movable)
        out.push({ id: 'move', label: '迁移存储', icon: Move, disabled: why, onSelect: () => open((p) => <MoveDiskDialog {...p} confid={row.key} />), separated: !isUsedDisk && out.length > 0 })
      if (isDisk) out.push({ id: 'reassign', label: '转移给其他虚拟机', icon: Unplug, disabled: why, onSelect: () => open((p) => <ReassignDialog {...p} confid={row.key} />) })
    }
    if (row.kind === 'efidisk' && !removed) {
      const d = parseDrive(state.next[row.key])
      if (d['pre-enrolled-keys'] === '1' && d['ms-cert'] !== '2023k') {
        out.push({ id: 'enroll', label: '注册新版微软证书', icon: RefreshCw, disabled: pending ? '有未生效的更改' : false, onSelect: () => enrollCert(row) })
      }
    }
    const core = ['memory', 'processors', 'bios', 'display', 'machine', 'scsihw', 'arch'].includes(row.kind)
    if (pending) out.push({ id: 'revert', label: '撤销未生效的更改', icon: RotateCcw, separated: out.length > 0, onSelect: () => void revert(row.keys, `撤销 ${row.title}`).catch(() => undefined) })
    if (!core && !removed) {
      out.push({
        id: 'remove',
        label: row.kind === 'disk' ? '分离' : '删除',
        icon: row.kind === 'disk' ? Unplug : Trash2,
        destructive: true,
        separated: out.length > 0,
        onSelect: () => removeRow(row),
      })
    }
    return out
  }

  const pendingCount = pendingRows.length

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rows.length} 项硬件
          {guest.template === 1 && <span className="ml-1">· 模板</span>}
        </p>
        <Button onClick={() => open((p) => <AddHardwareDialog {...p} onPick={(render) => window.setTimeout(() => open(render), 180)} />)}>
          <Plus />
          添加硬件
        </Button>
      </div>
      <PendingBanner
        count={pendingCount}
        running={running}
        onRevertAll={() =>
          open((p) => (
            <ConfirmDialog
              {...p}
              title="撤销全部未生效的更改？"
              description={`${pendingCount} 项硬件的更改会被丢弃，恢复为当前生效的配置。`}
              confirmLabel="全部撤销"
              onConfirm={() => revert([...new Set(pendingRows.flatMap((r) => r.keys))], '撤销未生效的硬件更改')}
            />
          ))
        }
      />
      {SECTIONS.map((section) => {
        const list = rows.filter((r) => r.section === section)
        if (list.length === 0) return null
        return (
          <ConfigSection key={section} title={HW_SECTION_LABEL[section]}>
            {list.map((row) => {
              const editor = editorFor(row)
              const actions = actionsFor(row)
              const onlyEdit = actions.length === 1 && actions[0]!.id === 'edit'
              return (
                <ConfigRow
                  key={row.id}
                  testId={`hw-${row.id}`}
                  icon={HW_ICON[row.kind]}
                  title={row.title}
                  summary={row.summary}
                  pendingSummary={row.pendingSummary}
                  status={row.status}
                  mono={['disk', 'unused', 'cdrom', 'cloudinit', 'efidisk', 'tpmstate', 'vmstate'].includes(row.kind)}
                  onOpen={
                    row.kind === 'cloudinit'
                      ? () => void navigate(guestPath(guest, 'cloudinit'))
                      : editor && row.status !== 'removed'
                        ? () => open(editor)
                        : undefined
                  }
                  openLabel={row.kind === 'cloudinit' ? `${row.title}：打开 Cloud-Init 设置` : `编辑${row.title}`}
                  actions={onlyEdit ? [] : actions}
                />
              )
            })}
          </ConfigSection>
        )
      })}
      {host}
    </div>
  )
}

// ------------------------------------------------------------ add menu

interface AddItem {
  id: string
  label: string
  description: string
  icon: LucideIcon
  disabled?: string | false
  render: (p: DialogRenderProps) => ReactNode
}

function AddHardwareDialog({ onPick, ...props }: DialogRenderProps & { onPick: (render: (p: DialogRenderProps) => ReactNode) => void }) {
  const { state, can } = useQemuConfig()
  const all = { ...state.current, ...state.next }
  const full = (n: number, max: number) => (n >= max ? `已达上限（${max} 个）` : false)
  const noPerm = '没有权限'
  const hw = can('VM.Config.HWType')
  const passthrough = can('Sys.Console', 'nodes') || can('Mapping.Use', 'mapping')
  const items: AddItem[] = [
    { id: 'disk', label: '硬盘', description: '在存储上新建磁盘', icon: HardDrive, disabled: !can('VM.Config.Disk') && noPerm, render: (p) => <DiskDialog {...p} mode="add" /> },
    { id: 'import', label: '导入硬盘', description: '从 qcow2 / vmdk / raw 镜像导入', icon: CloudDownload, disabled: !can('VM.Config.Disk') && noPerm, render: (p) => <DiskDialog {...p} mode="import" /> },
    { id: 'cdrom', label: 'CD/DVD 光驱', description: 'ISO 镜像或物理光驱', icon: Disc3, disabled: !can('VM.Config.CDROM') && noPerm, render: (p) => <CdromDialog {...p} /> },
    { id: 'net', label: '网络设备', description: '虚拟网卡', icon: Network, disabled: (!can('VM.Config.Network') && noPerm) || full(countKeys(all, /^net\d+$/), HW_MAX.net), render: (p) => <NetworkDialog {...p} /> },
    { id: 'efidisk', label: 'EFI 磁盘', description: 'UEFI 变量存储', icon: ShieldCheck, disabled: (!can('VM.Config.Disk') && noPerm) || (all.efidisk0 !== undefined && '已经有 EFI 磁盘'), render: (p) => <EfiDiskDialog {...p} /> },
    { id: 'tpm', label: 'TPM 状态', description: '虚拟 TPM 芯片', icon: KeyRound, disabled: (!can('VM.Config.Disk') && noPerm) || (all.tpmstate0 !== undefined && '已经有 TPM'), render: (p) => <TpmDialog {...p} /> },
    { id: 'usb', label: 'USB 设备', description: '直通或 SPICE 重定向', icon: Usb, disabled: (!passthrough && noPerm) || full(countKeys(all, /^usb\d+$/), maxUsbCount(all)), render: (p) => <UsbDialog {...p} /> },
    { id: 'pci', label: 'PCI 设备', description: '显卡、网卡等直通', icon: Microchip, disabled: (!passthrough && noPerm) || full(countKeys(all, /^hostpci\d+$/), HW_MAX.hostpci), render: (p) => <PciDialog {...p} /> },
    { id: 'serial', label: '串口', description: 'Socket 或宿主机串口', icon: Cable, disabled: (!hw && noPerm) || full(countKeys(all, /^serial\d+$/), HW_MAX.serial), render: (p) => <SerialDialog {...p} /> },
    { id: 'cloudinit', label: 'Cloud-Init 驱动器', description: '传递用户、密钥和网络配置', icon: Cloud, disabled: (!can('VM.Config.Cloudinit') && noPerm) || (hasCloudinitDrive(state) && '已经有 Cloud-Init 驱动器'), render: (p) => <CloudinitDriveDialog {...p} /> },
    { id: 'audio', label: '音频设备', description: 'ich9 / intel-hda / AC97', icon: Volume2, disabled: (!hw && noPerm) || (all.audio0 !== undefined && '已经有音频设备'), render: (p) => <AudioDialog {...p} /> },
    { id: 'rng', label: 'VirtIO RNG', description: '宿主机随机数源', icon: Dices, disabled: (!hw && noPerm) || (all.rng0 !== undefined && '已经有 RNG'), render: (p) => <RngDialog {...p} /> },
    { id: 'virtiofs', label: 'Virtiofs', description: '共享宿主机目录', icon: FolderSymlink, disabled: (!can('Sys.Console', 'nodes') && noPerm) || full(countKeys(all, /^virtiofs\d+$/), HW_MAX.virtiofs), render: (p) => <VirtiofsDialog {...p} /> },
  ]
  return (
    <ResponsiveDialog {...props} title="添加硬件" size="lg">
      <ul className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-3">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              disabled={!!item.disabled}
              onClick={() => {
                props.onOpenChange(false)
                onPick(item.render)
              }}
              className={cn(
                'flex h-full min-h-24 w-full flex-col items-start gap-2 rounded-xl border border-border/70 bg-(--field) p-3 text-left transition-colors outline-none',
                'hover:border-brand/40 hover:bg-brand/5 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] paper:hover:bg-secondary/60',
                'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border/70 disabled:hover:bg-(--field)',
              )}
            >
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand/10 text-brand-strong paper:bg-secondary paper:text-foreground/75">
                <item.icon className="size-4" aria-hidden />
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-xs leading-snug text-muted-foreground">{item.disabled || item.description}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ResponsiveDialog>
  )
}
