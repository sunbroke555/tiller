// Editors for storage devices: hard disks (add / import / edit / re-attach),
// CD/DVD, Cloud-Init drive, EFI disk, TPM state, and the disk actions
// (resize, move storage, reassign owner).

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { fetchQemuConfig, moveQemuDisk, reassignQemuDisk, resizeQemuDisk } from '@/api/qemu-config'
import { queryKeys, useClusterResources } from '@/api/queries'
import { isGuest } from '@/api/types'
import {
  FieldInput,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NumberInput,
  SelectField,
  StorageSelect,
  SwitchField,
} from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { parseDrive, stringifyPropertyString } from '@/lib/propstring'
import { formatBytes } from '@/lib/format'
import { parsePveSize } from '@/lib/size'

import { AIO_OPTIONS, BUS_LABEL, CACHE_OPTIONS, DEFAULT_CD_SLOT } from '../constants'
import { guestInvalidation, useQemuConfig, useSaveConfig, type DialogRenderProps } from '../context'
import { DRIVE_RE, busPreference, driveSizeGiB, nextFreeDrive, nextFreeKey, type Config } from '../model'
import {
  LIMIT_KEYS,
  cdromValue,
  diskOptionsFrom,
  editDiskValue,
  importDiskValue,
  newDiskValue,
  updateParams,
  type CdMedia,
  type DiskOptions,
} from '../params'
import { BusSlotFields, DiskTargetFields, VolumeSelect, type DiskTarget } from '../pickers'
import { Hint, InfoLine, Segmented } from '../ui'

// -------------------------------------------------------------- hard disk

export type DiskMode = 'add' | 'import' | 'edit' | 'unused'

function useFreeSlot(cfg: Config, buses: readonly string[], preferred?: string) {
  return useState(() => {
    if (preferred) {
      const m = DRIVE_RE.exec(preferred)
      if (m && cfg[preferred] === undefined) return { bus: m[1]!, index: Number(m[2]) }
    }
    return nextFreeDrive(cfg, buses) ?? { bus: buses[0]!, index: 0 }
  })
}

export function DiskDialog({ mode, confid, ...props }: DialogRenderProps & { mode: DiskMode; confid?: string }) {
  const { cfg, digest, node, arch, isRoot } = useQemuConfig()
  const save = useSaveConfig()
  const editing = mode === 'edit' && !!confid
  const buses = busPreference(cfg)
  const [slot, setSlot] = useFreeSlot(cfg, buses)
  const bus = editing ? DRIVE_RE.exec(confid)![1]! : slot.bus
  const existing = editing ? cfg[confid] : undefined
  const [opts, setOpts] = useState<DiskOptions>(() =>
    diskOptionsFrom(existing, {
      iothread: bus === 'virtio' || (bus === 'scsi' && cfg.scsihw === 'virtio-scsi-single'),
    }),
  )
  const setOpt = (patch: Partial<DiskOptions>) => setOpts((o) => ({ ...o, ...patch }))
  const [target, setTarget] = useState<DiskTarget>({ storage: undefined, format: undefined, size: 32 })
  const unusedKeys = Object.keys(cfg).filter((k) => /^unused\d+$/.test(k))
  const [unused, setUnused] = useState<string | undefined>(mode === 'unused' ? (confid ?? unusedKeys[0]) : undefined)
  const [importStorage, setImportStorage] = useState<string | undefined>()
  const [importSource, setImportSource] = useState<string | undefined>()
  const [importPath, setImportPath] = useState('')
  const [importKind, setImportKind] = useState<'storage' | 'path'>('storage')

  // IO thread follows the controller for new disks (official: virtio, or scsi + virtio-scsi-single).
  useEffect(() => {
    if (!editing) setOpts((o) => ({ ...o, iothread: bus === 'virtio' || (bus === 'scsi' && cfg.scsihw === 'virtio-scsi-single') }))
  }, [bus, editing, cfg.scsihw])

  const key = editing ? confid : `${slot.bus}${slot.index ?? ''}`
  const taken = (k: string) => cfg[k] !== undefined
  const slotInvalid = !editing && (slot.index === undefined || taken(key))

  let value: string | undefined
  let invalid = slotInvalid
  if (mode === 'add') {
    invalid ||= !target.storage || !target.size
    if (target.storage && target.size) value = newDiskValue(target.storage, target.size, target.format, bus, opts)
  } else if (mode === 'import') {
    const source = importKind === 'storage' ? importSource : importPath.trim()
    invalid ||= !target.storage || !source
    if (target.storage && source) value = importDiskValue(target.storage, source, target.format, bus, opts)
  } else if (mode === 'unused') {
    invalid ||= !unused
    if (unused && cfg[unused]) value = editDiskValue(cfg[unused]!, bus, opts)
  } else if (existing) {
    value = editDiskValue(existing, bus, opts)
  }

  const params = editing ? updateParams(cfg, { [key]: value }, digest) : value ? { [key]: value, digest } : null
  const title =
    mode === 'add' ? '添加硬盘' : mode === 'import' ? '导入硬盘' : mode === 'unused' ? '挂载未使用的磁盘' : `硬盘 (${confid})`
  const drive = parseDrive(existing)
  const virtio = bus === 'virtio'
  const ioCapable = bus === 'virtio' || bus === 'scsi'

  return (
    <FormDialog
      {...props}
      size="lg"
      title={title}
      description={mode === 'import' ? '从存储里的磁盘镜像（qcow2 / vmdk / raw）导入为新磁盘。' : undefined}
      submitLabel={mode === 'edit' ? '保存' : mode === 'import' ? '导入' : mode === 'unused' ? '挂载' : '添加'}
      submitDisabled={!params || invalid}
      onSubmit={() =>
        save(params, {
          title: mode === 'edit' ? `修改硬盘 ${confid}` : mode === 'import' ? `导入硬盘 ${key}` : mode === 'unused' ? `挂载磁盘到 ${key}` : `添加硬盘 ${key}`,
          // Allocating or importing volumes runs as a task (POST).
          async: mode === 'add' || mode === 'import',
        })
      }
    >
      {editing ? (
        <div className="grid gap-2 rounded-xl bg-secondary/50 px-3 py-2.5 paper:bg-secondary">
          <InfoLine label="磁盘镜像">{drive.file}</InfoLine>
          {drive.size && <InfoLine label="大小">{drive.size}</InfoLine>}
          <InfoLine label="总线">{BUS_LABEL[bus] ?? bus}</InfoLine>
        </div>
      ) : (
        <BusSlotFields buses={buses} bus={slot.bus} index={slot.index} onChange={(b, i) => setSlot({ bus: b, index: i ?? 0 })} taken={taken} />
      )}
      {!editing && bus === 'scsi' && (
        <p className="-mt-2 text-xs text-muted-foreground">SCSI 控制器：{cfg.scsihw ?? '默认 (LSI 53C895A)'}</p>
      )}

      {mode === 'unused' && (
        <FormField label="磁盘镜像" name="unused" required>
          <SelectField
            value={unused}
            onValueChange={setUnused}
            options={unusedKeys.map((k) => ({ value: k, label: cfg[k]!, description: k }))}
          />
        </FormField>
      )}

      {mode === 'import' && (
        <>
          {isRoot && (
            <Segmented
              aria-label="导入来源"
              value={importKind}
              onValueChange={setImportKind}
              options={[
                { value: 'storage', label: '存储里的镜像' },
                { value: 'path', label: '卷 ID / 绝对路径' },
              ]}
            />
          )}
          {importKind === 'storage' ? (
            <FormRow>
              <FormField label="来源存储" required>
                <StorageSelect node={node} content="import" value={importStorage} onValueChange={(s) => { setImportStorage(s); setImportSource(undefined) }} />
              </FormField>
              <FormField label="镜像" name="import-from" required>
                <VolumeSelect
                  node={node}
                  storage={importStorage}
                  content="import"
                  value={importSource}
                  onValueChange={setImportSource}
                  filter={(v) => ['qcow2', 'vmdk', 'raw'].includes(v.format ?? '')}
                  placeholder="选择磁盘镜像"
                />
              </FormField>
            </FormRow>
          ) : (
            <FormField label="来源" name="import-from" required hint="其他虚拟机的磁盘卷（如 local-lvm:vm-100-disk-0）或节点上的绝对路径（仅 root）。">
              <FieldInput value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="local-lvm:vm-100-disk-0" className="font-mono" />
            </FormField>
          )}
        </>
      )}

      {(mode === 'add' || mode === 'import') && (
        <DiskTargetFields
          node={node}
          value={target}
          onChange={setTarget}
          hideSize={mode === 'import'}
          storageLabel={mode === 'import' ? '目标存储' : '存储'}
        />
      )}

      <FormRow>
        <FormField label="缓存" name="cache">
          <SelectField value={opts.cache} onValueChange={(cache) => setOpt({ cache })} emptyOption="默认（无缓存）" options={CACHE_OPTIONS} />
        </FormField>
        <FormField label="异步 IO" name="aio">
          <SelectField value={opts.aio} onValueChange={(aio) => setOpt({ aio })} emptyOption="默认 (io_uring)" options={AIO_OPTIONS} />
        </FormField>
      </FormRow>
      <div className="grid gap-1 sm:grid-cols-2 sm:gap-x-6">
        <SwitchField label="Discard" description="把客户机释放的空间还给存储（精简置备）" checked={opts.discard} onCheckedChange={(discard) => setOpt({ discard })} />
        <SwitchField
          label="IO thread"
          description={ioCapable ? '独立 IO 线程' : '仅 VirtIO / SCSI'}
          checked={opts.iothread && ioCapable}
          disabled={!ioCapable}
          onCheckedChange={(iothread) => setOpt({ iothread })}
        />
      </div>

      <FormSection collapsible title="高级选项" defaultOpen={mode === 'edit' && (opts.ssd || opts.readonly || !opts.backup || !opts.replicate)}>
        <div className="grid gap-1 sm:grid-cols-2 sm:gap-x-6">
          <SwitchField
            label="SSD 仿真"
            description={virtio ? 'VirtIO Block 不支持' : '告诉客户机这是 SSD'}
            checked={opts.ssd && !virtio}
            disabled={virtio}
            onCheckedChange={(ssd) => setOpt({ ssd })}
          />
          <SwitchField
            label="只读"
            description={ioCapable ? '客户机只能读取' : '仅 VirtIO / SCSI'}
            checked={opts.readonly && ioCapable}
            disabled={!ioCapable}
            onCheckedChange={(readonly) => setOpt({ readonly })}
          />
          <SwitchField label="备份" description="包含在备份任务中" checked={opts.backup} onCheckedChange={(backup) => setOpt({ backup })} />
          <SwitchField label="跳过复制" description="存储复制时跳过这个磁盘" checked={!opts.replicate} onCheckedChange={(v) => setOpt({ replicate: !v })} />
        </div>
      </FormSection>

      <FormSection collapsible title="带宽限制" defaultOpen={LIMIT_KEYS.some((k) => opts[k] !== undefined)}>
        <FormRow>
          <FormField label="读取限速" name="mbps_rd">
            <NumberInput value={opts.mbps_rd} onChange={(v) => setOpt({ mbps_rd: v })} min={1} decimal unit="MB/s" placeholder="不限" />
          </FormField>
          <FormField label="读取突发" name="mbps_rd_max">
            <NumberInput value={opts.mbps_rd_max} onChange={(v) => setOpt({ mbps_rd_max: v })} min={1} decimal unit="MB" placeholder="默认" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="写入限速" name="mbps_wr">
            <NumberInput value={opts.mbps_wr} onChange={(v) => setOpt({ mbps_wr: v })} min={1} decimal unit="MB/s" placeholder="不限" />
          </FormField>
          <FormField label="写入突发" name="mbps_wr_max">
            <NumberInput value={opts.mbps_wr_max} onChange={(v) => setOpt({ mbps_wr_max: v })} min={1} decimal unit="MB" placeholder="默认" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="读取 IOPS" name="iops_rd">
            <NumberInput value={opts.iops_rd} onChange={(v) => setOpt({ iops_rd: v })} min={10} unit="ops/s" placeholder="不限" />
          </FormField>
          <FormField label="读取 IOPS 突发" name="iops_rd_max">
            <NumberInput value={opts.iops_rd_max} onChange={(v) => setOpt({ iops_rd_max: v })} min={10} unit="ops" placeholder="默认" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="写入 IOPS" name="iops_wr">
            <NumberInput value={opts.iops_wr} onChange={(v) => setOpt({ iops_wr: v })} min={10} unit="ops/s" placeholder="不限" />
          </FormField>
          <FormField label="写入 IOPS 突发" name="iops_wr_max">
            <NumberInput value={opts.iops_wr_max} onChange={(v) => setOpt({ iops_wr_max: v })} min={10} unit="ops" placeholder="默认" />
          </FormField>
        </FormRow>
      </FormSection>
      {arch === 'aarch64' && bus === 'ide' && <Hint tone="warning">ARM 虚拟机不支持 IDE 总线。</Hint>}
    </FormDialog>
  )
}

// ----------------------------------------------------------------- CD-ROM

export function CdromDialog({ confid, ...props }: DialogRenderProps & { confid?: string }) {
  const { cfg, digest, node, arch } = useQemuConfig()
  const save = useSaveConfig()
  const buses = arch === 'aarch64' ? ['scsi', 'sata'] : ['ide', 'sata', 'scsi']
  const [slot, setSlot] = useFreeSlot(cfg, buses, DEFAULT_CD_SLOT[arch])
  const existing = confid ? parseDrive(cfg[confid]) : undefined
  const initialMedia: CdMedia = !existing ? 'iso' : existing.file === 'cdrom' ? 'cdrom' : existing.file === 'none' || !existing.file ? 'none' : 'iso'
  const [media, setMedia] = useState<CdMedia>(initialMedia)
  const [iso, setIso] = useState<string | undefined>(initialMedia === 'iso' ? existing?.file : undefined)
  const [storage, setStorage] = useState<string | undefined>(iso ? iso.slice(0, iso.indexOf(':')) : undefined)
  const key = confid ?? `${slot.bus}${slot.index}`
  const taken = (k: string) => cfg[k] !== undefined
  const value = cdromValue(confid ? cfg[confid] : undefined, media, iso)
  const invalid = (media === 'iso' && !iso) || (!confid && taken(key))
  const params = confid ? updateParams(cfg, { [key]: value }, digest) : { [key]: value, digest }
  return (
    <FormDialog
      {...props}
      title={confid ? `CD/DVD 光驱 (${confid})` : '添加 CD/DVD 光驱'}
      submitLabel={confid ? '保存' : '添加'}
      submitDisabled={!params || invalid}
      onSubmit={() => save(params, { title: confid ? `更换光驱 ${confid} 介质` : `添加光驱 ${key}`, async: !confid })}
    >
      {!confid && <BusSlotFields buses={buses} bus={slot.bus} index={slot.index} onChange={(b, i) => setSlot({ bus: b, index: i ?? 0 })} taken={taken} />}
      <FormField label="介质">
        <Segmented
          aria-label="介质"
          value={media}
          onValueChange={setMedia}
          options={[
            { value: 'iso', label: 'ISO 镜像' },
            { value: 'cdrom', label: '物理光驱' },
            { value: 'none', label: '无介质' },
          ]}
        />
      </FormField>
      {media === 'iso' && (
        <FormRow>
          <FormField label="存储" required>
            <StorageSelect node={node} content="iso" value={storage} onValueChange={(s) => { setStorage(s); if (s !== storage) setIso(undefined) }} />
          </FormField>
          <FormField label="ISO 镜像" required name={key}>
            <VolumeSelect node={node} storage={storage} content="iso" value={iso} onValueChange={setIso} placeholder="选择 ISO" />
          </FormField>
        </FormRow>
      )}
      {media === 'cdrom' && <Hint>使用宿主机的物理光驱（/dev/cdrom）。</Hint>}
    </FormDialog>
  )
}

// ------------------------------------------------------------ cloud-init

export function CloudinitDriveDialog(props: DialogRenderProps) {
  const { cfg, digest, node, arch } = useQemuConfig()
  const save = useSaveConfig()
  const buses = arch === 'aarch64' ? ['scsi', 'sata'] : ['ide', 'sata', 'scsi']
  const [slot, setSlot] = useFreeSlot(cfg, buses, arch === 'aarch64' ? 'scsi1' : 'ide0')
  const [target, setTarget] = useState<DiskTarget>({ storage: undefined, format: undefined, size: undefined })
  const key = `${slot.bus}${slot.index}`
  const taken = (k: string) => cfg[k] !== undefined
  const value = target.storage ? stringifyPropertyString({ file: `${target.storage}:cloudinit`, format: target.format }, 'file') : undefined
  return (
    <FormDialog
      {...props}
      title="添加 Cloud-Init 驱动器"
      description="Cloud-Init 驱动器把用户、密码、SSH 公钥和网络配置传给客户机。添加后在“Cloud-Init”标签里编辑。"
      submitLabel="添加"
      submitDisabled={!value || taken(key)}
      onSubmit={() => save(value ? { [key]: value, digest } : null, { title: `添加 Cloud-Init 驱动器 ${key}` })}
    >
      <BusSlotFields buses={buses} bus={slot.bus} index={slot.index} onChange={(b, i) => setSlot({ bus: b, index: i ?? 0 })} taken={taken} />
      <DiskTargetFields node={node} value={target} onChange={setTarget} hideSize />
    </FormDialog>
  )
}

// ---------------------------------------------------------------- EFI / TPM

export function EfiDiskDialog(props: DialogRenderProps) {
  const { cfg, digest, node } = useQemuConfig()
  const save = useSaveConfig()
  const [target, setTarget] = useState<DiskTarget>({ storage: undefined, format: undefined, size: undefined })
  const [keys, setKeys] = useState(true)
  const ovmf = cfg.bios === 'ovmf'
  const value = target.storage
    ? stringifyPropertyString({ file: `${target.storage}:1`, efitype: '4m', 'pre-enrolled-keys': keys ? 1 : 0, format: target.format }, 'file')
    : undefined
  return (
    <FormDialog
      {...props}
      title="添加 EFI 磁盘"
      description="保存 OVMF (UEFI) 的启动项和安全启动设置。"
      submitLabel="添加"
      submitDisabled={!value}
      onSubmit={() => save(value ? { efidisk0: value, digest } : null, { title: '添加 EFI 磁盘', async: true })}
    >
      <DiskTargetFields node={node} value={target} onChange={setTarget} hideSize storageLabel="EFI 存储" />
      <SwitchField
        label="预注册密钥"
        description="使用带发行版和微软安全启动密钥（含 2023 证书）的 EFI 变量镜像，启用安全启动。"
        checked={keys}
        onCheckedChange={setKeys}
      />
      {!ovmf && <Hint tone="warning">这台虚拟机的 BIOS 不是 OVMF (UEFI)，EFI 磁盘不会被使用。</Hint>}
    </FormDialog>
  )
}

export function TpmDialog(props: DialogRenderProps) {
  const { digest, node } = useQemuConfig()
  const save = useSaveConfig()
  const [target, setTarget] = useState<DiskTarget>({ storage: undefined, format: undefined, size: undefined })
  const [version, setVersion] = useState<'v2.0' | 'v1.2'>('v2.0')
  const value = target.storage ? stringifyPropertyString({ file: `${target.storage}:1`, version, format: target.format }, 'file') : undefined
  return (
    <FormDialog
      {...props}
      title="添加 TPM 状态"
      description="虚拟 TPM，Windows 11 和 BitLocker 需要 v2.0。"
      submitLabel="添加"
      submitDisabled={!value}
      onSubmit={() => save(value ? { tpmstate0: value, digest } : null, { title: '添加 TPM 状态' })}
    >
      <DiskTargetFields node={node} value={target} onChange={setTarget} hideSize storageLabel="TPM 存储" />
      <FormField label="版本">
        <Segmented aria-label="TPM 版本" value={version} onValueChange={setVersion} options={[{ value: 'v2.0', label: 'v2.0' }, { value: 'v1.2', label: 'v1.2' }]} />
      </FormField>
    </FormDialog>
  )
}

// ------------------------------------------------------------ disk actions

export function ResizeDialog({ confid, ...props }: DialogRenderProps & { confid: string }) {
  const { cfg, digest, node, vmid } = useQemuConfig()
  const current = driveSizeGiB(cfg[confid])
  const [inc, setInc] = useState<number | undefined>(undefined)
  const next = current !== undefined && inc ? current + inc : undefined
  return (
    <FormDialog
      {...props}
      size="sm"
      title={`扩容 ${confid}`}
      description="磁盘只能增大，扩容后还需要在客户机里扩展分区和文件系统。"
      submitLabel="扩容"
      submitDisabled={!inc || inc <= 0}
      onSubmit={() =>
        runTask(resizeQemuDisk(node, vmid, confid, `+${inc}G`, digest), {
          title: `扩容 ${confid} +${inc} GiB`,
          invalidate: guestInvalidation(node, vmid),
          syncSuccessMessage: `${confid} 已扩容`,
        })
      }
    >
      <div className="grid gap-2 rounded-xl bg-secondary/50 px-3 py-2.5 paper:bg-secondary">
        <InfoLine label="磁盘">{parseDrive(cfg[confid]).file}</InfoLine>
        <InfoLine label="当前大小">{current !== undefined ? `${round(current)} GiB` : '未知'}</InfoLine>
      </div>
      <FormField label="增加" name="size" required hint={next !== undefined ? `扩容后：${round(next)} GiB` : undefined}>
        <NumberInput value={inc} onChange={setInc} min={0} max={128 * 1024} decimal unit="GiB" stepper step={1} autoFocus />
      </FormField>
    </FormDialog>
  )
}

const round = (n: number) => Math.round(n * 100) / 100

export function MoveDiskDialog({ confid, ...props }: DialogRenderProps & { confid: string }) {
  const { cfg, node, vmid, running } = useQemuConfig()
  const drive = parseDrive(cfg[confid])
  const [target, setTarget] = useState<DiskTarget>({ storage: undefined, format: undefined, size: undefined })
  const [deleteSource, setDeleteSource] = useState(false)
  const [bwlimit, setBwlimit] = useState<number | undefined>()
  const sourceStorage = drive.file?.split(':')[0]
  const sameStorage = target.storage === sourceStorage
  return (
    <FormDialog
      {...props}
      title={`迁移存储 (${confid})`}
      description={running ? '虚拟机运行中，会在线迁移磁盘（drive-mirror）。' : undefined}
      submitLabel="迁移"
      submitDisabled={!target.storage || sameStorage}
      onSubmit={() =>
        runTask(
          moveQemuDisk(node, vmid, {
            disk: confid,
            storage: target.storage!,
            format: target.format,
            delete: deleteSource || undefined,
            bwlimit: bwlimit ? Math.round(bwlimit * 1024) : undefined,
          }),
          { title: `迁移 ${confid} 到 ${target.storage}`, invalidate: guestInvalidation(node, vmid) },
        )
      }
    >
      <div className="grid gap-2 rounded-xl bg-secondary/50 px-3 py-2.5 paper:bg-secondary">
        <InfoLine label="源磁盘">{drive.file}</InfoLine>
        {drive.size && <InfoLine label="大小">{drive.size}</InfoLine>}
      </div>
      <DiskTargetFields node={node} value={target} onChange={setTarget} hideSize storageLabel="目标存储" />
      {sameStorage && <p className="-mt-2 text-xs text-destructive">目标存储和源存储相同。</p>}
      <SwitchField
        label="删除源磁盘"
        description="迁移成功后删除原来的卷；不勾选则原卷变成“未使用的磁盘”。"
        checked={deleteSource}
        onCheckedChange={setDeleteSource}
      />
      <FormSection collapsible title="高级选项">
        <FormField label="带宽限制" name="bwlimit" hint="留空使用数据中心 / 存储的默认限制">
          <NumberInput value={bwlimit} onChange={setBwlimit} min={1} decimal unit="MiB/s" placeholder="默认" />
        </FormField>
      </FormSection>
    </FormDialog>
  )
}

export function ReassignDialog({ confid, ...props }: DialogRenderProps & { confid: string }) {
  const { cfg, digest, node, vmid } = useQemuConfig()
  const { data: vms } = useClusterResources({
    select: (all) =>
      all
        .filter(isGuest)
        .filter((g) => g.type === 'qemu' && g.node === node && g.vmid !== vmid)
        .sort((a, b) => a.vmid - b.vmid),
  })
  const [targetVmid, setTargetVmid] = useState<string | undefined>()
  const target = useQuery({
    queryKey: ['pve', 'nodes', node, 'qemu', targetVmid ?? '', 'config', 'reassign'],
    queryFn: ({ signal }) => fetchQemuConfig(node, Number(targetVmid), signal),
    enabled: !!targetVmid,
    staleTime: 0,
  })
  const targetCfg = useMemo<Config>(
    () => Object.fromEntries(Object.entries(target.data ?? {}).map(([k, v]) => [k, String(v)])),
    [target.data],
  )
  const isUnused = /^unused\d+$/.test(confid)
  const buses = [...busPreference(targetCfg), 'unused']
  const [bus, setBus] = useState<string>(isUnused ? 'unused' : (DRIVE_RE.exec(confid)?.[1] ?? 'scsi'))
  const [index, setIndex] = useState<number | undefined>()

  // Pick the first free slot of the chosen bus once the target config is loaded.
  useEffect(() => {
    if (!target.data) return
    if (bus === 'unused') {
      const k = nextFreeKey(targetCfg, 'unused', 256)
      setIndex(k ? Number(k.slice(6)) : 0)
    } else {
      setIndex(nextFreeDrive(targetCfg, [bus])?.index ?? 0)
    }
  }, [target.data, targetCfg, bus])

  const targetDisk = index !== undefined ? `${bus}${index}` : undefined
  const conflict = !!targetDisk && targetCfg[targetDisk] !== undefined
  return (
    <FormDialog
      {...props}
      title={`转移 ${confid} 给其他虚拟机`}
      description="把磁盘的所有权转给同一节点上的另一台虚拟机，并挂到它的指定插槽。"
      submitLabel="转移"
      submitDisabled={!targetVmid || !targetDisk || conflict || !target.data}
      onSubmit={() =>
        runTask(
          reassignQemuDisk(node, vmid, {
            disk: confid,
            'target-vmid': Number(targetVmid),
            'target-disk': targetDisk!,
            digest,
            'target-digest': target.data?.digest ? String(target.data.digest) : undefined,
          }),
          {
            title: `转移 ${confid} 到 VM ${targetVmid}`,
            invalidate: [...guestInvalidation(node, vmid), queryKeys.guest(node, 'qemu', Number(targetVmid))],
          },
        )
      }
    >
      <div className="grid gap-2 rounded-xl bg-secondary/50 px-3 py-2.5 paper:bg-secondary">
        <InfoLine label="磁盘">{parseDrive(cfg[confid]).file}</InfoLine>
      </div>
      <FormField label="目标虚拟机" name="target-vmid" required>
        <SelectField
          value={targetVmid}
          onValueChange={setTargetVmid}
          placeholder={vms?.length === 0 ? '这个节点上没有其他虚拟机' : '选择虚拟机'}
          options={(vms ?? []).map((g) => ({
            value: String(g.vmid),
            label: `${g.vmid} · ${g.name ?? ''}`,
            description: g.template ? '模板' : g.status === 'running' ? '运行中' : '已停止',
          }))}
        />
      </FormField>
      {targetVmid && (
        <FormField label="目标插槽" name="target-disk" error={conflict ? `${targetDisk} 已被占用` : target.isError ? '无法读取目标虚拟机配置' : undefined}>
          <div className="flex gap-2">
            <SelectField
              aria-label="总线"
              className="flex-[3]"
              value={bus}
              onValueChange={(b) => b && setBus(b)}
              options={buses.map((b) => ({ value: b, label: b === 'unused' ? '未使用的磁盘' : (BUS_LABEL[b] ?? b) }))}
            />
            <div className="flex-[2]">
              <NumberInput aria-label="编号" value={index} onChange={setIndex} min={0} max={bus === 'unused' ? 255 : 30} />
            </div>
          </div>
        </FormField>
      )}
    </FormDialog>
  )
}

/** Human size of a drive for confirmations. */
export function driveSizeText(value: string | undefined): string | undefined {
  const b = parsePveSize(parseDrive(value).size)
  return b === null ? undefined : formatBytes(b)
}

