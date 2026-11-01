import { useEffect, useMemo, useState } from 'react'

import { restoreBackup, useBackupConfig, type StorageVolume } from '@/api/storage-browser'
import { useClusterResources } from '@/api/queries'
import { isStorage } from '@/api/types'
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
  VmidInput,
  type VmidValidity,
} from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { formatDateTime } from '@/lib/format'

import { parseBackupConfig, restoreParams, volumeName, volumeTime } from './volumes'

export interface RestoreDialogProps {
  node: string
  volume: StorageVolume
  type: 'qemu' | 'lxc'
  /** PBS backups of VMs can be restored live. */
  isPbs?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Restore a backup as a new guest (the storage view's restore; restoring over
 * an existing guest lives on the guest's backup tab). Same options as the
 * official restore window.
 */
export function RestoreDialog({ node, volume, type, isPbs, open, onOpenChange }: RestoreDialogProps) {
  const cfg = useBackupConfig(node, open ? volume.volid : null)
  const { data: nodeStorages } = useClusterResources({
    select: (all) => new Set(all.filter(isStorage).filter((s) => s.node === node).map((s) => s.storage)),
  })
  const info = useMemo(
    () => (cfg.data ? parseBackupConfig(cfg.data, nodeStorages) : null),
    [cfg.data, nodeStorages],
  )

  const [vmid, setVmid] = useState<number | undefined>()
  const [validity, setValidity] = useState<VmidValidity>('unknown')
  const [storage, setStorage] = useState<string | undefined>()
  const [unique, setUnique] = useState(false)
  const [start, setStart] = useState(false)
  const [live, setLive] = useState(false)
  const [unprivileged, setUnprivileged] = useState<'keep' | '1' | '0'>('keep')
  const [name, setName] = useState('')
  const [cores, setCores] = useState<number | undefined>()
  const [sockets, setSockets] = useState<number | undefined>()
  const [memory, setMemory] = useState<number | undefined>()
  const [bwlimit, setBwlimit] = useState<number | undefined>()

  useEffect(() => {
    if (!open) return
    setVmid(undefined)
    setStorage(undefined)
    setUnique(false)
    setStart(false)
    setLive(false)
    setUnprivileged('keep')
    setName('')
    setCores(undefined)
    setSockets(undefined)
    setMemory(undefined)
    setBwlimit(undefined)
  }, [open])

  const guest = type === 'lxc' ? 'CT' : 'VM'
  // Containers default to "local" without a storage, which rarely holds rootdir: require one.
  const storageRequired = type === 'lxc' || (info !== null && !info.storagesKnown)
  const time = volumeTime(volume)

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`恢复为新${type === 'lxc' ? '容器' : '虚拟机'}`}
      description={
        <span className="break-all">
          {volumeName(volume)}
          {time ? ` · ${formatDateTime(time)}` : ''}
        </span>
      }
      submitLabel="恢复"
      submitDisabled={validity !== 'free' || (storageRequired && !storage)}
      onSubmit={() =>
        runTask(
          restoreBackup(
            node,
            type,
            restoreParams({
              type,
              volid: volume.volid,
              vmid: vmid!,
              storage,
              bwlimit: bwlimit === undefined ? undefined : Math.round(bwlimit * 1024),
              unique,
              start,
              liveRestore: live,
              unprivileged,
              name,
              cores,
              sockets,
              memory,
            }),
          ),
          { title: `恢复备份到 ${guest} ${vmid}` },
        )
      }
    >
      <FormRow>
        <FormField label={`${guest} ID`} name="vmid" required>
          <VmidInput value={vmid} onChange={setVmid} onValidityChange={setValidity} />
        </FormField>
        <FormField
          label="目标存储"
          name="storage"
          required={storageRequired}
          hint={!storageRequired ? '留空则恢复到备份时所在的存储' : info && !info.storagesKnown ? '备份中的存储在此节点不可用' : undefined}
        >
          <StorageSelect
            node={node}
            content={type === 'lxc' ? 'rootdir' : 'images'}
            value={storage}
            onValueChange={setStorage}
            emptyOption={storageRequired ? undefined : '使用备份中的存储'}
          />
        </FormField>
      </FormRow>

      <div className="grid gap-1">
        <SwitchField label="唯一化" description="重新生成 MAC 地址等唯一属性" checked={unique} onCheckedChange={setUnique} />
        {type === 'qemu' && isPbs && (
          <SwitchField
            label="实时恢复"
            description="立即启动虚拟机，在后台恢复数据。出错时恢复期间写入的数据可能丢失。"
            checked={live}
            onCheckedChange={setLive}
          />
        )}
        <SwitchField label="恢复后启动" checked={start && !live} disabled={live} onCheckedChange={setStart} />
      </div>

      {type === 'lxc' && (
        <FormField label="权限级别" name="unprivileged">
          <SelectField
            value={unprivileged}
            onValueChange={(v) => setUnprivileged((v as 'keep' | '1' | '0') ?? 'keep')}
            options={[
              { value: 'keep', label: '与备份相同' },
              { value: '1', label: '非特权容器' },
              { value: '0', label: '特权容器' },
            ]}
          />
        </FormField>
      )}

      <FormSection collapsible title="覆盖设置" description="留空则使用备份中的值">
        <FormRow>
          <FormField label={type === 'lxc' ? '主机名' : '名称'} name={type === 'lxc' ? 'hostname' : 'name'}>
            <FieldInput value={name} onChange={(e) => setName(e.target.value)} placeholder={info?.name ?? ''} />
          </FormField>
          <FormField label="内存" name="memory">
            <NumberInput value={memory} onChange={setMemory} min={16} unit="MiB" placeholder={info?.memory ? String(info.memory) : ''} />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="核心" name="cores">
            <NumberInput value={cores} onChange={setCores} min={1} max={1024} placeholder={info?.cores ? String(info.cores) : ''} />
          </FormField>
          {type === 'qemu' ? (
            <FormField label="插槽" name="sockets">
              <NumberInput value={sockets} onChange={setSockets} min={1} max={16} placeholder={info?.sockets ? String(info.sockets) : ''} />
            </FormField>
          ) : (
            <span />
          )}
        </FormRow>
        <FormField label="带宽限制" name="bwlimit" hint="留空使用目标存储的限制，0 表示不限">
          <NumberInput value={bwlimit} onChange={setBwlimit} min={0} decimal unit="MiB/s" />
        </FormField>
      </FormSection>
    </FormDialog>
  )
}
