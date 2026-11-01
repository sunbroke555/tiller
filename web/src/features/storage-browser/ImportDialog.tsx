import { useEffect, useState } from 'react'
import { HardDrive, Loader2, Network, TriangleAlert } from 'lucide-react'

import { createImportedVm, useImportMetadata, type StorageVolume } from '@/api/storage-browser'
import { useNodeStorages } from '@/api/queries'
import {
  BridgeSelect,
  CheckboxField,
  FieldInput,
  FormDialog,
  FormError,
  FormField,
  FormRow,
  FormSection,
  NumberInput,
  StorageSelect,
  SwitchField,
  VmidInput,
  type VmidValidity,
} from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { errorMessage } from '@/lib/errors'
import { formatBytes } from '@/lib/format'

import {
  diskImportParams,
  importKind,
  importParams,
  importRows,
  importWarningText,
  volumeName,
  type ImportDiskRow,
  type ImportNetRow,
} from './volumes'

export interface ImportDialogProps {
  node: string
  storage: string
  volume: StorageVolume
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Create a VM from an import volume: OVA/OVF/ESXi guests through
 * import-metadata (official GuestImport, simplified), single disk images as
 * a new VM with that disk.
 */
export function ImportDialog({ node, storage, volume, open, onOpenChange }: ImportDialogProps) {
  const kind = importKind(volume.format)
  const volumeRef = volume.volid.replace(/^.*?:/, '')
  const meta = useImportMetadata(node, storage, open && kind === 'guest' ? volumeRef : null)
  const { data: storages } = useNodeStorages(node, 'images')

  const [vmid, setVmid] = useState<number | undefined>()
  const [validity, setValidity] = useState<VmidValidity>('unknown')
  const [name, setName] = useState('')
  const [sockets, setSockets] = useState<number | undefined>(1)
  const [cores, setCores] = useState<number | undefined>(1)
  const [memory, setMemory] = useState<number | undefined>(1024)
  const [target, setTarget] = useState<string | undefined>()
  const [bridge, setBridge] = useState<string | undefined>()
  const [live, setLive] = useState(false)
  const [working, setWorking] = useState<string | undefined>()
  const [uniqueMacs, setUniqueMacs] = useState(false)
  const [disks, setDisks] = useState<ImportDiskRow[]>([])
  const [nets, setNets] = useState<ImportNetRow[]>([])

  useEffect(() => {
    if (!open) return
    setVmid(undefined)
    setLive(false)
    setWorking(undefined)
    setUniqueMacs(false)
    if (kind === 'disk') {
      setName(volumeName(volume).replace(/\.(raw|qcow2|vmdk|img)$/i, '').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 60))
      setSockets(1)
      setCores(1)
      setMemory(1024)
    }
  }, [open])

  // Defaults from the source guest once its metadata arrived.
  useEffect(() => {
    const m = meta.data
    if (!m || !open) return
    const args = m['create-args']
    setName(typeof args.name === 'string' ? args.name : '')
    setSockets(Number(args.sockets) || 1)
    setCores(Number(args.cores) || 1)
    setMemory(Number(args.memory) || 512)
    const rows = importRows(m)
    setDisks(rows.disks)
    setNets(rows.nets)
  }, [meta.data, open])

  const isOva = !!meta.data?.warnings.some((w) => w.type === 'ova-needs-extracting')
  const storageType = storages?.find((s) => s.storage === target)?.type
  const warnings = meta.data?.warnings ?? []
  const ready = kind === 'disk' || !!meta.data

  const submit = () => {
    if (!vmid || !target || !bridge) throw new Error('请填写 VM ID、目标存储和网桥')
    const params =
      kind === 'disk'
        ? diskImportParams({
            vmid,
            name,
            cores: cores ?? 1,
            memory: memory ?? 1024,
            storage: target,
            storageType,
            bridge,
            volid: volume.volid,
          })
        : importParams(meta.data!, {
            vmid,
            name,
            sockets,
            cores,
            memory,
            storage: target,
            storageType,
            bridge,
            liveImport: live,
            workingStorage: isOva ? working : undefined,
            uniqueMacs,
            disks,
            nets,
          })
    return runTask(createImportedVm(node, params), { title: `导入 ${name || volumeName(volume)} 为 VM ${vmid}` })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={kind === 'disk' ? '用磁盘镜像创建虚拟机' : '导入虚拟机'}
      description={<span className="break-all">{volumeName(volume)}</span>}
      submitLabel="导入"
      submitDisabled={!ready || validity !== 'free' || !target || !bridge}
      onSubmit={submit}
    >
      {kind === 'guest' && meta.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> 正在读取虚拟机信息…
        </div>
      )}
      {kind === 'guest' && meta.isError && <FormError>无法读取导入信息：{errorMessage(meta.error)}</FormError>}

      {warnings.length > 0 && (
        <ul className="grid gap-1.5 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-foreground">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
              <span>{importWarningText(w)}</span>
            </li>
          ))}
        </ul>
      )}

      {ready && (
        <>
          <FormRow>
            <FormField label="VM ID" name="vmid" required>
              <VmidInput value={vmid} onChange={setVmid} onValidityChange={setValidity} />
            </FormField>
            <FormField label="名称" name="name">
              <FieldInput value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoCapitalize="off" />
            </FormField>
          </FormRow>
          <FormRow cols={3} className="grid-cols-2">
            {kind === 'guest' && (
              <FormField label="插槽" name="sockets">
                <NumberInput value={sockets} onChange={setSockets} min={1} max={16} stepper />
              </FormField>
            )}
            <FormField label="核心" name="cores">
              <NumberInput value={cores} onChange={setCores} min={1} max={1024} stepper />
            </FormField>
            <FormField label="内存" name="memory" className={kind === 'guest' ? 'col-span-2 sm:col-span-1' : undefined}>
              <NumberInput value={memory} onChange={setMemory} min={16} step={256} unit="MiB" />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="目标存储" name="storage" required hint="导入的磁盘写到这里">
              <StorageSelect node={node} content="images" value={target} onValueChange={setTarget} />
            </FormField>
            <FormField label="网桥" name="bridge" required>
              <BridgeSelect node={node} value={bridge} onValueChange={setBridge} />
            </FormField>
          </FormRow>

          {kind === 'guest' && (
            <>
              {disks.length > 0 && (
                <FormSection title="磁盘" description="取消勾选的磁盘不会导入">
                  <div className="grid gap-1 rounded-xl border border-border/70 px-3 py-1">
                    {disks.map((d) => (
                      <CheckboxField
                        key={d.id}
                        label={
                          <span className="inline-flex items-center gap-1.5">
                            <HardDrive className="size-3.5 text-muted-foreground" aria-hidden />
                            {d.id}
                          </span>
                        }
                        description={[d.volid ? d.volid.replace(/^.*?:/, '') : '新建空磁盘', d.size ? formatBytes(d.size) : null]
                          .filter(Boolean)
                          .join(' · ')}
                        checked={d.enabled}
                        onCheckedChange={(c) => setDisks((all) => all.map((x) => (x.id === d.id ? { ...x, enabled: c } : x)))}
                      />
                    ))}
                  </div>
                </FormSection>
              )}
              {nets.length > 0 && (
                <FormSection title="网卡">
                  <div className="grid gap-1 rounded-xl border border-border/70 px-3 py-1">
                    {nets.map((n) => (
                      <CheckboxField
                        key={n.id}
                        label={
                          <span className="inline-flex items-center gap-1.5">
                            <Network className="size-3.5 text-muted-foreground" aria-hidden />
                            {n.id}
                          </span>
                        }
                        description={[n.model, uniqueMacs ? '新 MAC' : n.macaddr, n.bridge ?? bridge].filter(Boolean).join(' · ')}
                        checked={n.enabled}
                        onCheckedChange={(c) => setNets((all) => all.map((x) => (x.id === n.id ? { ...x, enabled: c } : x)))}
                      />
                    ))}
                  </div>
                </FormSection>
              )}
              <FormSection collapsible title="高级选项">
                <SwitchField label="唯一 MAC 地址" description="让 PVE 生成新的 MAC 地址" checked={uniqueMacs} onCheckedChange={setUniqueMacs} />
                <SwitchField
                  label="实时导入"
                  description={
                    isOva ? '启动虚拟机并在后台导入磁盘' : '在 PVE 上启动（源端已关机的）虚拟机并在后台导入磁盘。出错时新写入的数据可能丢失。'
                  }
                  checked={live}
                  onCheckedChange={setLive}
                />
                {isOva && (
                  <FormField label="工作存储" name="import-working-storage" hint="解包 OVA 用的临时空间，留空使用源存储">
                    <StorageSelect node={node} content="images" value={working} onValueChange={setWorking} emptyOption="源存储" />
                  </FormField>
                )}
              </FormSection>
            </>
          )}
        </>
      )}
    </FormDialog>
  )
}
