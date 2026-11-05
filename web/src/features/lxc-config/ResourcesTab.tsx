import {
  ArrowRightLeft,
  Cpu,
  Database,
  Expand,
  FolderInput,
  Gauge,
  HardDrive,
  HardDriveDownload,
  MemoryStick,
  Plug,
  Plus,
  Repeat2,
  Scale,
  Trash2,
  Unplug,
  UserRoundCog,
} from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { isNode } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { GuestTabProps } from '@/features/guest/types'
import { formatBytes, formatPercent, ratio } from '@/lib/format'
import { METRIC_TEXT, usageTone } from '@/lib/metric-status'
import { cn } from '@/lib/utils'

import { useDialog } from './hooks'
import {
  cpuUnitsRange,
  deviceToForm,
  diskKeys,
  keysWithPrefix,
  mountFlags,
  mountKind,
  mountSize,
  parseLxcMount,
  pendingOf,
  splitKey,
} from './model'
import { MountPointDialog, type MountTargetKey } from './MountPointDialog'
import { CpuDialog, DeviceDialog, formatMiB, MemoryDialog, MoveVolumeDialog, ReassignDialog, ResizeDialog } from './ResourceDialogs'
import {
  ConfigRow,
  ConfigSection,
  PendingBanner,
  SectionAction,
  SectionNote,
  TabBody,
  useLxcConfig,
  type LxcConfigApi,
  type RowAction,
} from './shared'

/** Resources tab of a container: memory, CPU, disks and mount points, devices. */
export default function ResourcesTab(props: GuestTabProps) {
  const api = useLxcConfig(props)
  return (
    <TabBody api={api}>
      <ResourcesBody api={api} props={props} />
    </TabBody>
  )
}

interface Confirm {
  title: string
  description: string
  label: string
  typeToConfirm?: string
  run: () => Promise<unknown>
}

function ResourcesBody({ api, props }: { api: LxcConfigApi; props: GuestTabProps }) {
  const { guest } = props
  const { cfg, config } = api
  const memory = useDialog()
  const cpu = useDialog()
  const mount = useDialog<MountTargetKey>()
  const resize = useDialog<string>()
  const move = useDialog<string>()
  const reassign = useDialog<string>()
  const device = useDialog<string | undefined>()
  const confirm = useDialog<Confirm>()
  const { data: nodeInfo } = useClusterResources({ select: (all) => all.filter(isNode).find((n) => n.node === api.node) })
  const units = cpuUnitsRange(nodeInfo?.['cgroup-mode'])

  const revert = (key: string) => () => void api.revert([key]).catch(() => undefined)
  const pending = (key: string) => pendingOf(config, key)

  // Disks and devices pending removal are gone from the effective config: list them from the running one too.
  const all = { ...(config?.current ?? {}), ...cfg }
  const disks = diskKeys(all)
  const devices = keysWithPrefix(all, 'dev')
  const stoppedReason = api.running ? '需要先关闭容器' : false
  const lock = guest.lock ? `容器已锁定（${guest.lock}）` : false

  return (
    <>
      <PendingBanner api={api} tab="resources" />

      <div className="grid gap-(--section-gap) lg:grid-cols-2">
        <ConfigSection title="内存">
          <ConfigRow
            icon={MemoryStick}
            label="内存"
            value={formatMiB(cfg.memory ?? 512)}
            detail={api.running && guest.mem !== undefined ? <span className={METRIC_TEXT[usageTone(ratio(guest.mem, guest.maxmem))]}>已用 {formatBytes(guest.mem)}</span> : undefined}
            pending={pending('memory')}
            onEdit={() => memory.show(true)}
            onRevert={revert('memory')}
          />
          <ConfigRow
            icon={Repeat2}
            label="交换分区"
            value={cfg.swap === '0' ? '不使用' : formatMiB(cfg.swap ?? 512)}
            muted={cfg.swap === '0'}
            pending={pending('swap')}
            onEdit={() => memory.show(true)}
            onRevert={revert('swap')}
          />
        </ConfigSection>

        <ConfigSection title="处理器">
          <ConfigRow
            icon={Cpu}
            label="核心数"
            value={cfg.cores ? `${cfg.cores} 核` : '不限'}
            muted={!cfg.cores}
            detail={api.running && guest.cpu !== undefined ? <span className={METRIC_TEXT[usageTone(guest.cpu)]}>当前使用 {formatPercent(Math.max(0, guest.cpu))}</span> : undefined}
            pending={pending('cores')}
            onEdit={() => cpu.show(true)}
            onRevert={revert('cores')}
          />
          <ConfigRow
            icon={Gauge}
            label="CPU 限制"
            value={cfg.cpulimit && cfg.cpulimit !== '0' ? cfg.cpulimit : '不限'}
            muted={!cfg.cpulimit || cfg.cpulimit === '0'}
            pending={pending('cpulimit')}
            onEdit={() => cpu.show(true)}
            onRevert={revert('cpulimit')}
          />
          <ConfigRow
            icon={Scale}
            label="CPU 权重"
            value={cfg.cpuunits ?? `${units.def}（默认）`}
            muted={!cfg.cpuunits}
            pending={pending('cpuunits')}
            onEdit={() => cpu.show(true)}
            onRevert={revert('cpuunits')}
          />
        </ConfigSection>
      </div>

      <ConfigSection
        id="lxc-disks"
        title="磁盘与挂载点"
        action={
          <SectionAction icon={Plus} onClick={() => mount.show({ mode: 'create' })}>
            添加挂载点
          </SectionAction>
        }
      >
        {disks.map((key) => (
          <DiskRow
            key={key}
            diskKey={key}
            value={cfg[key] ?? config?.current[key] ?? ''}
            api={api}
            pending={pending(key)}
            onRevert={revert(key)}
            stoppedReason={stoppedReason || lock}
            onEdit={(k) => mount.show({ mode: 'edit', key: k })}
            onAttach={(k) => mount.show({ mode: 'attach', key: k })}
            onResize={resize.show}
            onMove={move.show}
            onReassign={reassign.show}
            onConfirm={confirm.show}
          />
        ))}
        {disks.length <= 1 && <SectionNote>没有额外的挂载点。添加挂载点可以给容器挂一块新卷，或（root）绑定主机上的目录。</SectionNote>}
      </ConfigSection>

      <ConfigSection
        id="lxc-devices"
        title="设备直通"
        action={
          <SectionAction
            icon={Plus}
            onClick={() => device.show(undefined)}
            disabled={!api.isRoot}
            title={api.isRoot ? undefined : '仅 root@pam 可以添加设备'}
          >
            添加设备
          </SectionAction>
        }
      >
        {devices.map((key) => {
          const d = deviceToForm(cfg[key] ?? config?.current[key])
          const detail = [
            d.uid !== undefined ? `UID ${d.uid}` : null,
            d.gid !== undefined ? `GID ${d.gid}` : null,
            d.mode || null,
            d.denyWrite ? '只读' : null,
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <ConfigRow
              key={key}
              icon={Plug}
              label={`设备 ${key}`}
              value={<span className="font-mono text-[13px]">{d.path}</span>}
              detail={detail || undefined}
              pending={pending(key)}
              onRevert={revert(key)}
              onEdit={api.isRoot ? () => device.show(key) : undefined}
              actions={
                api.isRoot && !pending(key)?.delete
                  ? [
                      {
                        id: 'remove',
                        label: '删除',
                        icon: Trash2,
                        destructive: true,
                        separated: true,
                        onSelect: () =>
                          confirm.show({
                            title: `删除设备 ${key}？`,
                            description: `${d.path} 将不再直通给容器。`,
                            label: '删除',
                            run: () => api.send({ delete: key }, `删除设备 ${key}`),
                          }),
                      },
                    ]
                  : []
              }
            />
          )
        })}
        {devices.length === 0 && (
          <SectionNote>
            没有直通的设备。{api.isRoot ? '可以把 /dev 下的设备（如显卡渲染节点）交给容器使用。' : '只有 root@pam 可以添加设备直通。'}
          </SectionNote>
        )}
      </ConfigSection>

      <MemoryDialog {...memory.props} api={api} />
      <CpuDialog {...cpu.props} api={api} />
      <MountPointDialog {...mount.props} api={api} target={mount.data} />
      <ResizeDialog {...resize.props} api={api} disk={resize.data} />
      <MoveVolumeDialog {...move.props} api={api} disk={move.data} />
      <ReassignDialog {...reassign.props} api={api} disk={reassign.data} />
      <DeviceDialog {...device.props} api={api} devKey={device.data} />
      <ConfirmDialog
        {...confirm.props}
        title={confirm.data?.title ?? ''}
        description={confirm.data?.description}
        confirmLabel={confirm.data?.label}
        typeToConfirm={confirm.data?.typeToConfirm}
        destructive
        onConfirm={() => confirm.data?.run()}
      />
    </>
  )
}

function DiskRow({
  diskKey: key,
  value,
  api,
  pending,
  onRevert,
  stoppedReason,
  onEdit,
  onAttach,
  onResize,
  onMove,
  onReassign,
  onConfirm,
}: {
  diskKey: string
  value: string
  api: LxcConfigApi
  pending: ReturnType<typeof pendingOf>
  onRevert: () => void
  stoppedReason: string | false
  onEdit: (key: string) => void
  onAttach: (key: string) => void
  onResize: (key: string) => void
  onMove: (key: string) => void
  onReassign: (key: string) => void
  onConfirm: (c: Confirm) => void
}) {
  const m = parseLxcMount(value)
  const isRoot = key === 'rootfs'
  const unused = splitKey(key)?.prefix === 'unused'
  const kind = mountKind(m.volume)
  const isVolume = kind === 'volume'
  const deleting = !!pending?.delete
  const size = mountSize(m)

  if (unused) {
    return (
      <ConfigRow
        icon={HardDriveDownload}
        label={`未使用的磁盘 ${splitKey(key)!.index}`}
        value={<span className="text-[13px]">{m.volume}</span>}
        detail="已分离，仍占用存储空间。可以重新挂载、转给其他容器或删除。"
        muted
        pending={pending}
        onRevert={onRevert}
        onEdit={deleting ? undefined : () => onAttach(key)}
        editLabel="挂载"
        actions={
          deleting
            ? []
            : [
                { id: 'reassign', label: '转移所有者', icon: UserRoundCog, onSelect: () => onReassign(key) },
                {
                  id: 'delete',
                  label: '删除',
                  icon: Trash2,
                  destructive: true,
                  separated: true,
                  onSelect: () =>
                    onConfirm({
                      title: `删除未使用的磁盘 ${splitKey(key)!.index}？`,
                      description: `卷 ${m.volume} 及其中的所有数据将被永久删除，无法恢复。`,
                      label: '永久删除',
                      typeToConfirm: key,
                      run: () => api.send({ delete: key }, `删除 ${m.volume}`),
                    }),
                },
              ]
        }
      />
    )
  }

  const canEdit = isVolume || api.isRoot
  const actions: RowAction[] = []
  if (!deleting && isVolume) {
    actions.push(
      { id: 'resize', label: '扩容', icon: Expand, onSelect: () => onResize(key) },
      { id: 'move', label: '迁移存储', icon: Database, onSelect: () => onMove(key), disabled: stoppedReason },
    )
    if (!isRoot) actions.push({ id: 'reassign', label: '转移所有者', icon: ArrowRightLeft, onSelect: () => onReassign(key), disabled: stoppedReason })
  }
  if (!deleting && !isRoot) {
    actions.push({
      id: 'detach',
      label: isVolume ? '分离' : '删除',
      icon: isVolume ? Unplug : Trash2,
      destructive: true,
      separated: true,
      onSelect: () =>
        onConfirm(
          isVolume
            ? {
                title: `分离挂载点 ${key}？`,
                description: `卷会变成“未使用的磁盘”，数据保留，之后可以重新挂载或删除。${api.running ? '运行中的容器会在重启后生效。' : ''}`,
                label: '分离',
                run: () => api.send({ delete: key }, `分离挂载点 ${key}`),
              }
            : {
                title: `删除挂载点 ${key}？`,
                description: `只移除挂载配置，主机上的 ${m.volume} 不受影响。`,
                label: '删除',
                run: () => api.send({ delete: key }, `删除挂载点 ${key}`),
              },
        ),
    })
  }

  const flags = mountFlags(m, isRoot)
  const detail = [isRoot ? null : m.volume, size || null, ...flags].filter(Boolean).join(' · ')
  return (
    <ConfigRow
      icon={isRoot ? HardDrive : isVolume ? HardDrive : FolderInput}
      label={isRoot ? '根磁盘' : `挂载点 ${key}`}
      value={
        isRoot ? (
          <span className="text-[13px]">{m.volume}</span>
        ) : (
          <span className={cn('font-mono text-[13px]', !m.mp && 'text-muted-foreground')}>{m.mp || '（无路径）'}</span>
        )
      }
      detail={detail}
      badges={
        !isRoot && !isVolume ? (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{kind === 'device' ? '设备' : '绑定'}</span>
        ) : undefined
      }
      pending={pending}
      formatPending={(v) => (v ? (isRoot ? v.split(',').slice(1).join(',') || v : (parseLxcMount(v).mp ?? v)) : '（未设置）')}
      onRevert={onRevert}
      onEdit={canEdit && !deleting ? () => onEdit(key) : undefined}
      editLabel={isRoot ? '编辑选项' : '编辑'}
      actions={actions}
    />
  )
}
