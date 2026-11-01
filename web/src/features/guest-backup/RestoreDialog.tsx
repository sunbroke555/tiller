import { useEffect, useMemo, useState } from 'react'
import { CopyPlus, Loader2, RotateCcw } from 'lucide-react'

import { backupGuestType, startRestore, useBackupConfig, type BackupVolume } from '@/api/guest-backup'
import { fetchNextId, useNodeStorages } from '@/api/queries'
import type { GuestType } from '@/api/types'
import {
  FieldInput,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NumberInput,
  StorageSelect,
  SwitchField,
  VmidInput,
  type VmidValidity,
} from '@/components/form'
import { runTask, type TaskHandle } from '@/components/tasks/tracker'
import { formatBytes, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { allStoragesAvailable, backupFileName, parseBackupConfig, restoreParams, validateGuestName } from './logic'
import { ChoiceCards, Notice } from './ui'

export interface RestoreTarget {
  vmid: number
  /** Display name of the existing guest. */
  name?: string | undefined
  /** Live status; overwriting needs a stopped guest. */
  status?: string | undefined
}

export interface RestoreDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Node that runs the restore (and owns the target storage). */
  node: string
  /** The backup to restore. Only volid is required; format/subtype help detect the guest type. */
  backup: Pick<BackupVolume, 'volid'> & Partial<Pick<BackupVolume, 'format' | 'subtype' | 'ctime' | 'size' | 'storage' | 'notes' | 'vmid'>>
  /** Guest type; detected from the backup when omitted. */
  type?: GuestType | undefined
  /**
   * The existing guest the backup belongs to (guest Backup tab): offers
   * "覆盖当前客户机" (force=1) besides restoring as a new guest. Without it
   * (storage browser) the backup is restored as a new guest.
   */
  target?: RestoreTarget | undefined
  /** The backup lives on Proxmox Backup Server: enables live restore. */
  isPBS?: boolean | undefined
  /** Called once the restore task started. */
  onStarted?: ((handle: TaskHandle, vmid: number) => void) | undefined
}

/**
 * Restore a vzdump/PBS backup over an existing guest or as a new one
 * (POST /nodes/{node}/qemu with archive, or /nodes/{node}/lxc with
 * ostemplate + restore=1). Reusable from the storage browser:
 *
 *   <RestoreDialog open={open} onOpenChange={setOpen} node={node} backup={volume} isPBS={plugintype === 'pbs'} />
 */
export function RestoreDialog({ open, onOpenChange, node, backup, type: typeProp, target, isPBS, onStarted }: RestoreDialogProps) {
  const type: GuestType | null = typeProp ?? backupGuestType({ volid: backup.volid, format: backup.format ?? '', subtype: backup.subtype })
  const config = useBackupConfig(node, backup.volid, open)
  const info = useMemo(() => parseBackupConfig(config.data), [config.data])
  const targetContent = type === 'lxc' ? 'rootdir' : 'images'
  const nodeStorages = useNodeStorages(open ? node : null, targetContent)
  const storagesKnown = config.isSuccess && nodeStorages.isSuccess
  const needStorage =
    type === 'lxc' || (storagesKnown && !allStoragesAvailable(info, (nodeStorages.data ?? []).filter((s) => s.active !== 0).map((s) => s.storage)))

  const [overwrite, setOverwrite] = useState(!!target)
  const [vmid, setVmid] = useState<number | undefined>(undefined)
  const [validity, setValidity] = useState<VmidValidity>('unknown')
  const [storage, setStorage] = useState<string | undefined>(undefined)
  const [bwlimit, setBwlimit] = useState<number | undefined>(undefined)
  const [unique, setUnique] = useState(false)
  const [start, setStart] = useState(false)
  const [ha, setHa] = useState(false)
  const [live, setLive] = useState(false)
  const [unprivileged, setUnprivileged] = useState<'keep' | '1' | '0'>('keep')
  const [name, setName] = useState('')
  const [memory, setMemory] = useState<number | undefined>(undefined)
  const [cores, setCores] = useState<number | undefined>(undefined)
  const [sockets, setSockets] = useState<number | undefined>(undefined)
  const [confirm, setConfirm] = useState('')

  useEffect(() => {
    if (!open) return
    setOverwrite(!!target)
    setVmid(undefined)
    setStorage(undefined)
    setBwlimit(undefined)
    setUnique(!target)
    setStart(false)
    setHa(false)
    setLive(false)
    setUnprivileged('keep')
    setName('')
    setMemory(undefined)
    setCores(undefined)
    setSockets(undefined)
    setConfirm('')
  }, [open, target?.vmid])

  // Suggest the next free ID once, without overwriting what the user typed meanwhile.
  const wantsId = open && !(target && overwrite)
  useEffect(() => {
    if (!wantsId) return
    let alive = true
    fetchNextId()
      .then((next) => {
        if (alive && Number.isFinite(next)) setVmid((v) => v ?? next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [wantsId])

  if (!type) {
    return (
      <FormDialog open={open} onOpenChange={onOpenChange} title="无法恢复" submitDisabled onSubmit={() => undefined}>
        <Notice tone="error">无法识别这个备份是虚拟机还是容器的备份：{backup.volid}</Notice>
      </FormDialog>
    )
  }

  const label = type === 'qemu' ? 'VM' : 'CT'
  const isOverwrite = !!target && overwrite
  const targetRunning = isOverwrite && !!target?.status && target.status !== 'stopped'
  const targetVmid = isOverwrite ? target!.vmid : vmid
  const nameError = validateGuestName(name)
  const confirmOk = !isOverwrite || confirm.trim() === String(target!.vmid)
  const vmidOk = isOverwrite || (vmid !== undefined && validity === 'free')
  const storageOk = !needStorage || !!storage
  const disabled = !vmidOk || !storageOk || !!nameError || !confirmOk || targetRunning

  const submit = async () => {
    if (targetVmid === undefined) throw new Error('请填写 VMID')
    const params = restoreParams(type, backup.volid, {
      overwrite: isOverwrite,
      vmid: targetVmid,
      storage,
      bwlimitMiB: bwlimit,
      unique,
      start,
      haManaged: ha,
      liveRestore: live,
      unprivileged,
      name,
      memory,
      cores,
      sockets,
    })
    const handle = await runTask(startRestore(node, type, params), {
      title: isOverwrite ? `恢复备份覆盖 ${label} ${targetVmid}` : `从备份恢复 ${label} ${targetVmid}`,
    })
    onStarted?.(handle, targetVmid)
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isOverwrite ? `恢复并覆盖 ${label} ${target!.vmid}` : `从备份恢复${type === 'qemu' ? '虚拟机' : '容器'}`}
      description={
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-mono text-xs" title={backup.volid}>
            {backupFileName(backup.volid)}
          </span>
          {(backup.ctime || backup.size) && (
            <span className="text-xs">
              {[backup.ctime ? formatDateTime(backup.ctime) : null, backup.size ? formatBytes(backup.size) : null, backup.storage].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      }
      submitLabel={isOverwrite ? '覆盖并恢复' : '恢复'}
      destructive={isOverwrite}
      submitDisabled={disabled}
      onSubmit={submit}
    >
      {target && (
        <ChoiceCards
          aria-label="恢复方式"
          value={overwrite ? 'overwrite' : 'new'}
          onValueChange={(v) => {
            setOverwrite(v === 'overwrite')
            setUnique(v === 'new')
          }}
          columns={2}
          options={[
            {
              value: 'overwrite',
              label: '覆盖当前客户机',
              icon: <RotateCcw />,
              description: `用备份替换 ${target.name ?? `${label} ${target.vmid}`} 的全部数据`,
            },
            { value: 'new', label: '恢复为新客户机', icon: <CopyPlus />, description: '保留当前客户机，用新的 VMID 创建一份' },
          ]}
        />
      )}

      {config.isPending && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> 正在读取备份中的配置…
        </p>
      )}
      {config.error && <Notice tone="warning">无法读取备份中的配置，将使用默认值。</Notice>}

      {!isOverwrite && (
        <FormField label={`新 ${label} 的 ID`} name="vmid" required>
          <VmidInput value={vmid} onChange={setVmid} onValidityChange={setValidity} autoFill={false} />
        </FormField>
      )}

      <FormRow>
        <FormField
          label="目标存储"
          name="storage"
          required={needStorage}
          hint={type === 'qemu' && !needStorage ? '留空则恢复到备份时各磁盘所在的存储' : needStorage && type === 'qemu' ? '备份中有磁盘所在的存储在此节点上不存在' : undefined}
        >
          <StorageSelect
            node={node}
            content={targetContent}
            value={storage}
            onValueChange={setStorage}
            autoSelect={needStorage}
            emptyOption={needStorage ? undefined : '使用备份中的存储'}
          />
        </FormField>
        <FormField label="限速" name="bwlimit" hint="留空使用存储的默认限制，0 表示不限速">
          <NumberInput value={bwlimit} onChange={setBwlimit} min={0} decimal unit="MiB/s" placeholder="默认" />
        </FormField>
      </FormRow>

      <div className="grid gap-1">
        <SwitchField label="唯一化" description="重新生成 MAC 地址等唯一属性，避免与原客户机冲突" checked={unique} onCheckedChange={setUnique} />
        {type === 'qemu' && isPBS && (
          <SwitchField
            label="实时恢复"
            description="立即启动虚拟机，数据在后台恢复"
            checked={live}
            onCheckedChange={(v) => {
              setLive(v)
              if (v) setStart(false)
            }}
          />
        )}
        <SwitchField
          label="恢复后启动"
          checked={live ? true : start}
          disabled={live}
          description={live ? '实时恢复会自动启动' : undefined}
          onCheckedChange={setStart}
        />
        <SwitchField label="加入 HA" description="恢复后作为高可用资源管理" checked={ha} onCheckedChange={setHa} />
      </div>
      {live && <Notice tone="warning">实时恢复过程中如果出错，虚拟机在此期间写入的新数据可能丢失。</Notice>}

      {type === 'lxc' && (
        <FormField label="权限级别" name="unprivileged">
          <ChoiceCards
            aria-label="权限级别"
            value={unprivileged}
            onValueChange={setUnprivileged}
            columns={3}
            dense
            options={[
              {
                value: 'keep',
                label: '与备份相同',
                description: info.unprivileged === undefined ? undefined : info.unprivileged ? '备份为非特权' : '备份为特权',
              },
              { value: '1', label: '非特权' },
              { value: '0', label: '特权' },
            ]}
          />
        </FormField>
      )}

      <FormSection collapsible title="覆盖设置" description="留空则使用备份中的值">
        <FormRow>
          <FormField label={type === 'lxc' ? '主机名' : '名称'} name={type === 'lxc' ? 'hostname' : 'name'} error={nameError}>
            <FieldInput value={name} onChange={(e) => setName(e.target.value)} placeholder={info.name ?? ''} autoCapitalize="off" spellCheck={false} />
          </FormField>
          <FormField label="内存" name="memory">
            <NumberInput value={memory} onChange={setMemory} min={16} unit="MiB" placeholder={info.memory ?? ''} />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="CPU 核心" name="cores">
            <NumberInput value={cores} onChange={setCores} min={1} max={type === 'qemu' ? 128 : 8192} placeholder={info.cores ?? ''} />
          </FormField>
          {type === 'qemu' && (
            <FormField label="CPU 插槽" name="sockets">
              <NumberInput value={sockets} onChange={setSockets} min={1} max={4} placeholder={info.sockets ?? ''} />
            </FormField>
          )}
        </FormRow>
      </FormSection>

      {isOverwrite && (
        <div className="grid gap-3">
          <Notice tone={targetRunning ? 'error' : 'warning'}>
            {targetRunning
              ? `${label} ${target!.vmid} 正在运行。请先关机，再覆盖恢复。`
              : `${label} ${target!.vmid} 当前的全部数据会被永久替换${type === 'lxc' ? '（挂载点卷也会被清除）' : ''}，无法撤销。`}
          </Notice>
          <FormField label={<>请输入 <span className="font-mono">{target!.vmid}</span> 以确认覆盖</>}>
            <FieldInput
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              disabled={targetRunning}
              className={cn('font-mono', confirmOk && confirm && 'border-destructive/50')}
            />
          </FormField>
        </div>
      )}
    </FormDialog>
  )
}

export default RestoreDialog
