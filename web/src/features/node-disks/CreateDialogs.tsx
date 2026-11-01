import { useEffect, useMemo, useState } from 'react'
import { Check, HardDrive, Info } from 'lucide-react'

import { createDiskStorage, useUnusedDisks, type DiskEntry, type DiskStorageKind } from '@/api/node-disks'
import { CheckboxField, FieldInput, FormDialog, FormField, FormRow, NumberInput, SelectField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  createTaskTitle,
  isDraid,
  simpleCreateParams,
  storageIdError,
  zfsCreateParams,
  zfsDevicesError,
  zpoolNameError,
  ZFS_ASHIFT_DEFAULT,
  ZFS_ASHIFT_MAX,
  ZFS_ASHIFT_MIN,
  ZFS_COMPRESSION,
  ZFS_RAID_LEVELS,
  type DirectoryFilesystem,
  type ZfsCompression,
  type ZfsRaidLevel,
} from './model'
import { useDiskPermissions } from './shared'

interface DialogProps {
  node: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SIMPLE_TITLE: Record<Exclude<DiskStorageKind, 'zfs'>, string> = {
  lvm: '创建 LVM 卷组',
  lvmthin: '创建 LVM-Thin 池',
  directory: '创建目录存储',
}

const SIMPLE_DESCRIPTION: Record<Exclude<DiskStorageKind, 'zfs'>, string> = {
  lvm: '在未使用的磁盘或分区上创建卷组。',
  lvmthin: '在未使用的磁盘或分区上创建卷组和占满它的 Thin 池（卷组同名）。',
  directory: '格式化未使用的磁盘或分区，并挂载到 /mnt/pve/<名称>。',
}

function deviceDescription(d: DiskEntry) {
  return [formatBytes(d.size), d.serial || d.model].filter(Boolean).join(' · ')
}

/** Shared "add storage" checkbox: needs Datastore.Allocate on /storage. */
function AddStorageField({ checked, onChange, allowed }: { checked: boolean; onChange: (v: boolean) => void; allowed: boolean }) {
  return (
    <CheckboxField
      label="添加为存储"
      description={allowed ? '同时在数据中心存储配置里添加同名存储（仅限本节点）。' : '没有权限（需要 /storage 上的 Datastore.Allocate）。'}
      checked={checked && allowed}
      onCheckedChange={onChange}
      disabled={!allowed}
    />
  )
}

function NoDisks() {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-sm text-muted-foreground ring-1 ring-border/60 ring-inset">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      没有未使用的磁盘或分区。要重新使用一块磁盘，先在“磁盘”里擦除它。
    </p>
  )
}

/** LVM volume group, LVM-Thin pool or directory on one unused disk. */
export function CreateSimpleDialog({ node, open, onOpenChange, kind }: DialogProps & { kind: Exclude<DiskStorageKind, 'zfs'> }) {
  const perms = useDiskPermissions()
  const disks = useUnusedDisks(node, open)
  const [device, setDevice] = useState<string | undefined>()
  const [name, setName] = useState('')
  const [filesystem, setFilesystem] = useState<DirectoryFilesystem>('ext4')
  const [addStorage, setAddStorage] = useState(true)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!open) {
      setDevice(undefined)
      setName('')
      setFilesystem('ext4')
      setAddStorage(true)
      setTouched(false)
    }
  }, [open])

  const list = disks.data ?? []
  const nameError = storageIdError(name)
  const options = list.map((d) => ({ value: d.devpath, label: d.devpath, description: deviceDescription(d) }))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={SIMPLE_TITLE[kind]}
      description={SIMPLE_DESCRIPTION[kind]}
      submitLabel="创建"
      submitDisabled={!device || !!nameError}
      onSubmit={() =>
        runTask(
          createDiskStorage(node, kind, simpleCreateParams(kind, { name, device: device!, filesystem, addStorage: addStorage && perms.storage })),
          { title: createTaskTitle(kind, name.trim()), node },
        )
      }
    >
      <FormField label="磁盘" name="device" required>
        {disks.isPending ? (
          <Skeleton className="h-10 rounded-lg" />
        ) : list.length === 0 ? (
          <NoDisks />
        ) : (
          <SelectField value={device} onValueChange={setDevice} options={options} placeholder="选择未使用的磁盘" />
        )}
      </FormField>
      <FormRow>
        <FormField
          label="名称"
          name="name"
          required
          error={touched && name ? nameError : undefined}
          hint={kind === 'directory' && name && !nameError ? `挂载点 /mnt/pve/${name.trim()}` : '也是存储 ID'}
        >
          <FieldInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={kind === 'directory' ? 'backup' : kind === 'lvmthin' ? 'thinpool' : 'vg-data'}
            autoCapitalize="off"
            spellCheck={false}
          />
        </FormField>
        {kind === 'directory' && (
          <FormField label="文件系统" name="filesystem">
            <SelectField
              value={filesystem}
              onValueChange={(v) => setFilesystem(v ?? 'ext4')}
              options={[
                { value: 'ext4', label: 'ext4' },
                { value: 'xfs', label: 'xfs' },
              ]}
            />
          </FormField>
        )}
      </FormRow>
      <AddStorageField checked={addStorage} onChange={setAddStorage} allowed={perms.storage} />
    </FormDialog>
  )
}

/** ZFS pool: RAID level, devices in order, compression, ashift, dRAID config. */
export function CreateZfsDialog({ node, open, onOpenChange }: DialogProps) {
  const perms = useDiskPermissions()
  const disks = useUnusedDisks(node, open)
  const [name, setName] = useState('')
  const [raidlevel, setRaidlevel] = useState<ZfsRaidLevel>('single')
  const [devices, setDevices] = useState<string[]>([])
  const [compression, setCompression] = useState<ZfsCompression>('on')
  const [ashift, setAshift] = useState<number | undefined>(ZFS_ASHIFT_DEFAULT)
  const [draidData, setDraidData] = useState<number | undefined>()
  const [draidSpares, setDraidSpares] = useState<number | undefined>()
  const [addStorage, setAddStorage] = useState(true)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!open) {
      setName('')
      setRaidlevel('single')
      setDevices([])
      setCompression('on')
      setAshift(ZFS_ASHIFT_DEFAULT)
      setDraidData(undefined)
      setDraidSpares(undefined)
      setAddStorage(true)
      setTouched(false)
    }
  }, [open])

  const list = disks.data ?? []
  const draid = isDraid(raidlevel)
  const nameError = zpoolNameError(name)
  const devicesError = zfsDevicesError(raidlevel, devices.length, { data: draidData, spares: draidSpares })
  const draidError = draid && (draidData === undefined || draidSpares === undefined) ? '请填写 dRAID 的数据盘数和备盘数' : null
  const ashiftOk = ashift !== undefined && ashift >= ZFS_ASHIFT_MIN && ashift <= ZFS_ASHIFT_MAX
  const toggle = (devpath: string) =>
    setDevices((cur) => (cur.includes(devpath) ? cur.filter((d) => d !== devpath) : raidlevel === 'single' ? [devpath] : [...cur, devpath]))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="创建 ZFS 池"
      description="ZFS 不适用于硬件 RAID 卡后面的磁盘，请把磁盘直通（HBA / IT 模式）。"
      size="lg"
      submitLabel="创建"
      submitDisabled={!!nameError || !!devicesError || !!draidError || !ashiftOk}
      onSubmit={() =>
        runTask(
          createDiskStorage(
            node,
            'zfs',
            zfsCreateParams({
              name,
              raidlevel,
              devices,
              ashift: ashift ?? ZFS_ASHIFT_DEFAULT,
              compression,
              addStorage: addStorage && perms.storage,
              draidData,
              draidSpares,
            }),
          ),
          { title: createTaskTitle('zfs', name.trim()), node },
        )
      }
    >
      <FormRow>
        <FormField label="名称" name="name" required error={touched && name ? nameError : undefined} hint="也是存储 ID">
          <FieldInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="tank"
            autoCapitalize="off"
            spellCheck={false}
          />
        </FormField>
        <FormField label="RAID 级别" name="raidlevel">
          <SelectField
            value={raidlevel}
            onValueChange={(v) => {
              const next = v ?? 'single'
              setRaidlevel(next)
              if (next === 'single') setDevices((cur) => cur.slice(0, 1))
            }}
            options={ZFS_RAID_LEVELS.map((l) => ({ value: l.value, label: l.label, description: `${l.description}，至少 ${l.min} 块` }))}
          />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="压缩" name="compression">
          <SelectField
            value={compression}
            onValueChange={(v) => setCompression(v ?? 'on')}
            options={ZFS_COMPRESSION.map((c) => ({ value: c, label: c === 'on' ? 'on（默认算法）' : c }))}
          />
        </FormField>
        <FormField
          label="ashift"
          name="ashift"
          hint="扇区大小 2^ashift 字节，4K 盘用 12"
          error={ashift !== undefined && !ashiftOk ? `范围 ${ZFS_ASHIFT_MIN}–${ZFS_ASHIFT_MAX}` : undefined}
        >
          <NumberInput value={ashift} onChange={setAshift} min={ZFS_ASHIFT_MIN} max={ZFS_ASHIFT_MAX} stepper />
        </FormField>
      </FormRow>
      {draid && (
        <FormRow>
          <FormField label="数据盘数" name="draid-config" required hint="每个冗余组的数据盘数">
            <NumberInput value={draidData} onChange={setDraidData} min={1} stepper />
          </FormField>
          <FormField label="分布式备盘数" required>
            <NumberInput value={draidSpares} onChange={setDraidSpares} min={0} stepper />
          </FormField>
        </FormRow>
      )}
      <FormField
        label="磁盘"
        name="devices"
        required
        labelExtra={devices.length > 0 ? `已选 ${devices.length} 块` : undefined}
        hint={raidlevel === 'raid10' ? '按选择顺序两两组成镜像。' : undefined}
        error={devices.length > 0 ? devicesError : undefined}
      >
        {disks.isPending ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : list.length === 0 ? (
          <NoDisks />
        ) : (
          <DevicePicker disks={list} selected={devices} onToggle={toggle} />
        )}
      </FormField>
      <AddStorageField checked={addStorage} onChange={setAddStorage} allowed={perms.storage} />
    </FormDialog>
  )
}

/** Tap-to-select list; the badge shows the order a disk was picked in. */
function DevicePicker({ disks, selected, onToggle }: { disks: readonly DiskEntry[]; selected: readonly string[]; onToggle: (devpath: string) => void }) {
  const sorted = useMemo(() => [...disks].sort((a, b) => a.devpath.localeCompare(b.devpath, undefined, { numeric: true })), [disks])
  return (
    <ul className="grid grid-cols-1 gap-1.5" aria-label="未使用的磁盘">
      {sorted.map((d) => {
        const order = selected.indexOf(d.devpath)
        const on = order >= 0
        return (
          <li key={d.devpath}>
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => onToggle(d.devpath)}
              className={cn(
                'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left ring-1 ring-border ring-inset transition-colors',
                on ? 'bg-brand/10 ring-brand/50 paper:bg-secondary' : 'hover:bg-foreground/[0.03]',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-medium tabular',
                  on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground ring-1 ring-border ring-inset',
                )}
              >
                {on ? selected.length > 1 ? order + 1 : <Check className="size-3.5" /> : <HardDrive className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]">{d.devpath}</span>
                <span className="block truncate text-xs text-muted-foreground">{[d.model, d.serial].filter(Boolean).join(' · ') || '—'}</span>
              </span>
              <span className="shrink-0 text-xs tabular">{formatBytes(d.size)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
