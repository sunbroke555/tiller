import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Disc3, HardDrive, Loader2, Network, TriangleAlert } from 'lucide-react'

import { useStorageFormats, type NodeStorageWithFormats } from '@/api/qemu-config'
import { useNodeNetworks } from '@/api/queries'
import { createImportedVm, useImportMetadata, type ImportMetadata, type StorageVolume } from '@/api/storage-browser'
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
  SelectField,
  StorageSelect,
  SwitchField,
  VmidInput,
  type VmidValidity,
} from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { DISK_FORMAT_LABEL, NIC_MODEL_LABEL, OS_TYPES, SCSIHW } from '@/features/qemu-config/constants'
import { DiskTargetFields, SearchSelect, VolumeSelect, storageFormats, type DiskTarget } from '@/features/qemu-config/pickers'
import { errorMessage } from '@/lib/errors'
import { formatBytes } from '@/lib/format'
import { QEMU_NIC_MODELS } from '@/lib/propstring'

import {
  defaultPrepareVirtio,
  diskImportParams,
  importKind,
  importParams,
  importRows,
  importScsihw,
  importWarningText,
  isWindowsOs,
  keepKnownBridges,
  virtioDiskMap,
  visibleCdRows,
  volumeName,
  type ImportCdRow,
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

const OS_OPTIONS = OS_TYPES.flatMap((g) => g.items.map((i) => ({ value: i.value, label: i.label, group: g.group, description: i.value })))
const SCSIHW_OPTIONS = Object.entries(SCSIHW).map(([value, label]) => ({ value, label }))
const NIC_OPTIONS = QEMU_NIC_MODELS.map((m) => ({ value: m, label: NIC_MODEL_LABEL[m] ?? m }))

/**
 * Create a VM from an import volume: OVA/OVF/ESXi guests through
 * import-metadata (official GuestImport: general settings, per-disk storage
 * and format, per-NIC model / bridge / VLAN, CD/DVD ISOs, OS type, SCSI
 * controller and VirtIO preparation), single disk images as a new VM with
 * that disk.
 */
export function ImportDialog({ node, storage, volume, open, onOpenChange }: ImportDialogProps) {
  const kind = importKind(volume.format)
  const volumeRef = volume.volid.replace(/^.*?:/, '')
  const meta = useImportMetadata(node, storage, open && kind === 'guest' ? volumeRef : null)
  const { data: storages } = useStorageFormats(node)
  const bridges = useNodeNetworks(node, 'any_bridge')

  const [vmid, setVmid] = useState<number | undefined>()
  const [validity, setValidity] = useState<VmidValidity>('unknown')
  const [name, setName] = useState('')
  const [sockets, setSockets] = useState<number | undefined>(1)
  const [cores, setCores] = useState<number | undefined>(1)
  const [memory, setMemory] = useState<number | undefined>(1024)
  const [target, setTarget] = useState<DiskTarget>({ storage: undefined, format: undefined, size: undefined })
  const [bridge, setBridge] = useState<string | undefined>()
  const [ostype, setOstype] = useState<string | undefined>()
  const [scsihw, setScsihw] = useState('')
  const [prepareVirtio, setPrepareVirtio] = useState(false)
  const [live, setLive] = useState(false)
  const [working, setWorking] = useState<string | undefined>()
  const [uniqueMacs, setUniqueMacs] = useState(false)
  const [disks, setDisks] = useState<ImportDiskRow[]>([])
  const [nets, setNets] = useState<ImportNetRow[]>([])
  const [cdroms, setCdroms] = useState<ImportCdRow[]>([])
  const bridgesChecked = useRef<ImportMetadata | null>(null)

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
    const os = typeof args.ostype === 'string' ? args.ostype : 'l26'
    const prep = defaultPrepareVirtio(m)
    setOstype(os)
    setPrepareVirtio(prep)
    setScsihw(importScsihw(m, os, prep))
    const rows = importRows(m)
    setDisks(rows.disks)
    setNets(rows.nets)
    setCdroms(rows.cdroms)
    bridgesChecked.current = null
  }, [meta.data, open])

  // Source bridges that do not exist on this node fall back to the default bridge.
  useEffect(() => {
    const known = bridges.data?.map((b) => b.iface)
    if (!meta.data || !known || bridgesChecked.current === meta.data) return
    bridgesChecked.current = meta.data
    setNets((all) => keepKnownBridges(all, known))
  }, [meta.data, bridges.data])

  const isOva = !!meta.data?.warnings.some((w) => w.type === 'ova-needs-extracting')
  const storageType = storages?.find((s) => s.storage === target.storage)?.type
  const warnings = meta.data?.warnings ?? []
  const ready = kind === 'disk' || !!meta.data
  const windows = isWindowsOs(ostype)
  const shownCds = visibleCdRows(cdroms, ostype)
  const diskMap = useMemo(
    () => (meta.data && prepareVirtio && windows ? virtioDiskMap(meta.data, { disks, nets, cdroms }, ostype) : {}),
    [meta.data, prepareVirtio, windows, disks, nets, cdroms, ostype],
  )

  const changeOs = (os: string | undefined) => {
    setOstype(os)
    if (meta.data) setScsihw(importScsihw(meta.data, os, prepareVirtio))
  }
  const changePrepare = (on: boolean) => {
    setPrepareVirtio(on)
    if (meta.data) setScsihw(importScsihw(meta.data, ostype, on))
  }

  const guestParams = (id: number) =>
    importParams(meta.data!, {
      vmid: id,
      name,
      sockets,
      cores,
      memory,
      storage: target.storage!,
      format: target.format,
      storageType,
      bridge: bridge!,
      ostype,
      scsihw,
      prepareVirtio,
      liveImport: live,
      workingStorage: isOva ? working : undefined,
      uniqueMacs,
      disks,
      nets,
      cdroms,
    })

  // "生成的配置" (official Resulting Config tab).
  let preview: [string, string | number][] | null = null
  if (kind === 'guest' && meta.data && target.storage && bridge) {
    try {
      preview = Object.entries(guestParams(vmid ?? 0))
        .filter(([k]) => k !== 'vmid')
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    } catch {
      preview = null
    }
  }

  const submit = () => {
    if (!vmid || !target.storage || !bridge) throw new Error('请填写 VM ID、目标存储和网桥')
    const params =
      kind === 'disk'
        ? diskImportParams({
            vmid,
            name,
            cores: cores ?? 1,
            memory: memory ?? 1024,
            storage: target.storage,
            format: target.format,
            storageType,
            bridge,
            volid: volume.volid,
          })
        : guestParams(vmid)
    return runTask(createImportedVm(node, params), { title: `导入 ${name || volumeName(volume)} 为 VM ${vmid}` })
  }

  const setDisk = (id: string, patch: Partial<ImportDiskRow>) => setDisks((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const setNet = (id: string, patch: Partial<ImportNetRow>) => setNets((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const setCd = (id: string, patch: Partial<ImportCdRow>) => setCdroms((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={kind === 'disk' ? '用磁盘镜像创建虚拟机' : '导入虚拟机'}
      description={<span className="break-all">{volumeName(volume)}</span>}
      submitLabel="导入"
      submitDisabled={!ready || validity !== 'free' || !target.storage || !bridge}
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
          {kind === 'guest' && (
            <FormField label="操作系统" name="ostype" hint={windows ? 'Windows：可在高级选项里为 VirtIO 做准备。' : undefined}>
              <SearchSelect value={ostype} onValueChange={(v) => v && changeOs(v)} options={OS_OPTIONS} searchPlaceholder="搜索操作系统…" />
            </FormField>
          )}
          <DiskTargetFields
            node={node}
            hideSize
            storageLabel={kind === 'guest' ? '默认存储' : '目标存储'}
            value={target}
            onChange={setTarget}
          />
          <FormField label={kind === 'guest' ? '默认网桥' : '网桥'} name="bridge" required>
            <BridgeSelect node={node} value={bridge} onValueChange={setBridge} />
          </FormField>

          {kind === 'guest' && (
            <>
              {disks.length > 0 && (
                <FormSection title="磁盘" description="每块磁盘可以放到不同的存储；取消勾选的不导入。">
                  <div className="grid gap-2">
                    {disks.map((d) => (
                      <DiskRow
                        key={d.id}
                        disk={d}
                        mappedTo={diskMap[d.id]}
                        storages={storages}
                        defaultLabel={target.storage}
                        onChange={(patch) => setDisk(d.id, patch)}
                      />
                    ))}
                  </div>
                </FormSection>
              )}
              {nets.length > 0 && (
                <FormSection title="网卡">
                  <div className="grid gap-2">
                    {nets.map((n) => (
                      <NetRow key={n.id} node={node} net={n} uniqueMacs={uniqueMacs} defaultBridge={bridge} onChange={(patch) => setNet(n.id, patch)} />
                    ))}
                  </div>
                  <SwitchField label="唯一 MAC 地址" description="让 PVE 生成新的 MAC 地址" checked={uniqueMacs} onCheckedChange={setUniqueMacs} />
                </FormSection>
              )}
              {shownCds.length > 0 && (
                <FormSection
                  title="CD/DVD 驱动器"
                  description={shownCds.some((c) => c.extra) ? '可以挂载 VirtIO 驱动 ISO（virtio-win），方便在 Windows 里安装驱动。' : '源主机上的光盘无法导入，可以改挂本机的 ISO。'}
                >
                  <div className="grid gap-2">
                    {shownCds.map((c) => (
                      <CdRow key={c.id} node={node} cd={c} onChange={(patch) => setCd(c.id, patch)} />
                    ))}
                  </div>
                </FormSection>
              )}
              <FormSection collapsible title="高级选项" defaultOpen={prepareVirtio}>
                <SwitchField
                  label="为 VirtIO-SCSI 做准备"
                  description={
                    windows
                      ? '把 SCSI 磁盘改接到 SATA，并把 SCSI 控制器换成 VirtIO SCSI single，装好驱动后再切换到 VirtIO-SCSI。'
                      : '只适用于 Windows 虚拟机。'
                  }
                  checked={prepareVirtio && windows}
                  disabled={!windows}
                  onCheckedChange={changePrepare}
                />
                <FormField label="SCSI 控制器" name="scsihw">
                  <SelectField value={scsihw} onValueChange={(v) => setScsihw(v ?? '')} options={SCSIHW_OPTIONS} emptyOption="默认 (LSI 53C895A)" />
                </FormField>
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
              {preview && (
                <FormSection collapsible title="生成的配置" description={`${preview.length} 项`}>
                  <dl
                    aria-label="生成的配置"
                    className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl border border-border/70 px-3 py-2.5 font-mono text-xs"
                  >
                    {preview.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="break-all">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </FormSection>
              )}
            </>
          )}
        </>
      )}
    </FormDialog>
  )
}

function RowCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="grid gap-2 rounded-xl border border-border/70 px-3 py-1.5 [&>[data-slot=form-row]]:pb-2">
      {children}
    </div>
  )
}

function DiskRow({
  disk: d,
  mappedTo,
  storages,
  defaultLabel,
  onChange,
}: {
  disk: ImportDiskRow
  mappedTo: string | undefined
  storages: NodeStorageWithFormats[] | undefined
  defaultLabel: string | undefined
  onChange: (patch: Partial<ImportDiskRow>) => void
}) {
  const list = (storages ?? []).filter((s) => s.active !== 0).sort((a, b) => a.storage.localeCompare(b.storage))
  const own = list.find((s) => s.storage === d.storage)
  const { formats, preferred } = storageFormats(own)
  const outOfSata = mappedTo === d.id
  return (
    <RowCard label={`磁盘 ${d.id}`}>
      <CheckboxField
        label={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <HardDrive className="size-3.5 text-muted-foreground" aria-hidden />
            {d.id}
            {mappedTo && !outOfSata && <span className="font-normal text-muted-foreground">→ {mappedTo}</span>}
          </span>
        }
        description={[d.volid ? d.volid.replace(/^.*\//, '') : '新建空磁盘', d.size ? formatBytes(d.size) : null].filter(Boolean).join(' · ')}
        checked={d.enabled}
        onCheckedChange={(enabled) => onChange({ enabled })}
      />
      {outOfSata && d.enabled && (
        <p className="flex items-start gap-1.5 text-xs text-warning-strong">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> 磁盘太多，没有空闲的 SATA 位置，保留为 SCSI。
        </p>
      )}
      {d.enabled && (
        <FormRow>
          <FormField label="存储" name={`${d.id}-storage`}>
            <SelectField
              value={d.storage}
              onValueChange={(storage) => {
                const s = list.find((x) => x.storage === storage)
                onChange({ storage, format: storage ? storageFormats(s).preferred : undefined })
              }}
              emptyOption={defaultLabel ? `默认（${defaultLabel}）` : '默认存储'}
              options={list.map((s) => ({ value: s.storage, label: s.storage, description: s.type, disabled: s.active === 0 }))}
            />
          </FormField>
          {d.storage && formats.length > 1 && (
            <FormField label="格式" name={`${d.id}-format`}>
              <SelectField
                value={d.format ?? preferred}
                onValueChange={(format) => onChange({ format })}
                options={formats.map((f) => ({ value: f, label: DISK_FORMAT_LABEL[f] ?? f }))}
              />
            </FormField>
          )}
        </FormRow>
      )}
    </RowCard>
  )
}

function NetRow({
  node,
  net: n,
  uniqueMacs,
  defaultBridge,
  onChange,
}: {
  node: string
  net: ImportNetRow
  uniqueMacs: boolean
  defaultBridge: string | undefined
  onChange: (patch: Partial<ImportNetRow>) => void
}) {
  return (
    <RowCard label={`网卡 ${n.id}`}>
      <CheckboxField
        label={
          <span className="inline-flex items-center gap-1.5">
            <Network className="size-3.5 text-muted-foreground" aria-hidden />
            {n.id}
          </span>
        }
        description={<span className="font-mono">{uniqueMacs || !n.macaddr ? 'MAC 自动生成' : n.macaddr}</span>}
        checked={n.enabled}
        onCheckedChange={(enabled) => onChange({ enabled })}
      />
      {n.enabled && (
        <FormRow cols={3}>
          <FormField label="型号" name={`${n.id}-model`}>
            <SelectField value={n.model} onValueChange={(model) => model && onChange({ model })} options={NIC_OPTIONS} />
          </FormField>
          <FormField label="网桥" name={`${n.id}-bridge`}>
            <BridgeSelect
              node={node}
              value={n.bridge}
              onValueChange={(bridge) => onChange({ bridge })}
              emptyOption={defaultBridge ? `默认（${defaultBridge}）` : '默认网桥'}
            />
          </FormField>
          <FormField label="VLAN" name={`${n.id}-tag`}>
            <NumberInput value={n.tag} onChange={(tag) => onChange({ tag })} min={1} max={4094} placeholder="无" />
          </FormField>
        </FormRow>
      )}
    </RowCard>
  )
}

function CdRow({ node, cd, onChange }: { node: string; cd: ImportCdRow; onChange: (patch: Partial<ImportCdRow>) => void }) {
  const [isoStorage, setIsoStorage] = useState<string | undefined>(cd.iso?.replace(/:.*$/, ''))
  return (
    <RowCard label={`光驱 ${cd.id}`}>
      <CheckboxField
        label={
          <span className="inline-flex items-center gap-1.5">
            <Disc3 className="size-3.5 text-muted-foreground" aria-hidden />
            {cd.id}
          </span>
        }
        description={cd.extra ? '额外的光驱（VirtIO 驱动）' : cd.iso ? cd.iso.replace(/^.*\//, '') : '空光驱'}
        checked={cd.enabled}
        onCheckedChange={(enabled) => onChange({ enabled })}
      />
      {cd.enabled && (
        <FormRow>
          <FormField label="ISO 存储" name={`${cd.id}-storage`}>
            <StorageSelect
              node={node}
              content="iso"
              value={isoStorage}
              onValueChange={(s) => {
                setIsoStorage(s)
                if (s !== isoStorage) onChange({ iso: undefined })
              }}
              emptyOption="不挂载"
            />
          </FormField>
          {isoStorage && (
            <FormField label="ISO 镜像" name={`${cd.id}-iso`}>
              <VolumeSelect node={node} storage={isoStorage} content="iso" value={cd.iso} onValueChange={(iso) => onChange({ iso })} placeholder="选择 ISO" />
            </FormField>
          )}
        </FormRow>
      )}
    </RowCard>
  )
}
