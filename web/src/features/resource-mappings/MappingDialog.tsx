// Add / edit a PCI, USB or directory mapping, in the four modes of the
// official dialog: create (name + first node), edit the mapping-wide fields,
// edit one node's entries, or add another node.

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { useHostPci, useHostUsb, type HostUsbDevice } from '@/api/qemu-config'
import { mappingApi, type ClusterMapping, type MappingKind } from '@/api/resource-mappings'
import { isNode } from '@/api/types'
import { FieldInput, FormDialog, FormField, NodeSelect, SwitchField } from '@/components/form'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import {
  createMappingParams,
  dirMapEntry,
  globalMappingParams,
  groupByNode,
  iommuMissing,
  mappedNodes,
  nodeMappingParams,
  normalizePciSelection,
  pciChoices,
  pciMapEntries,
  sharedIommuGroups,
  usbDeviceId,
  usbMapEntry,
  usbPortPath,
  validateDirPath,
  validateMappingId,
  type MapItem,
  type UsbMode,
} from './logic'
import { KIND_META, mappingWrite } from './meta'
import { Note, ValidationError, useFormState } from './ui'

export type MappingTarget =
  | { mode: 'create' }
  | { mode: 'global'; mapping: ClusterMapping }
  | { mode: 'node'; mapping: ClusterMapping; node: string }
  | { mode: 'add-node'; mapping: ClusterMapping }

interface Form {
  id: string
  description: string
  mdev: boolean
  liveMigration: boolean
  node: string | undefined
  pciPaths: string[]
  usbMode: UsbMode
  usbValue: string
  dirPath: string
}

function initForm(target: MappingTarget): Form {
  const mapping = target.mode === 'create' ? undefined : target.mapping
  const node = target.mode === 'node' ? target.node : undefined
  const items: MapItem[] = node ? (groupByNode(mapping?.map).find((g) => g.node === node)?.items ?? []) : []
  const first = items[0]
  return {
    id: mapping?.id ?? '',
    description: mapping?.description ?? '',
    mdev: mapping?.mdev === true || mapping?.mdev === 1,
    liveMigration: !!mapping?.['live-migration-capable'],
    node,
    pciPaths: items.map((i) => i.path ?? '').filter(Boolean),
    usbMode: first?.path ? 'path' : 'id',
    usbValue: (first?.path ?? first?.id) || '',
    dirPath: first?.path ?? '',
  }
}

export function MappingDialog({
  open,
  onOpenChange,
  kind,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: MappingKind
  target: MappingTarget
}) {
  const meta = KIND_META[kind]
  const [f, setF] = useFormState(open, () => initForm(target))
  const set = (patch: Partial<Form>) => setF((v) => ({ ...v, ...patch }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setErrors({})
  }

  const mapping = target.mode === 'create' ? undefined : target.mapping
  const showGlobal = target.mode === 'create' || target.mode === 'global'
  const showEntries = target.mode !== 'global'
  const configured = mappedNodes(mapping?.map)
  const previous = f.node ? (groupByNode(mapping?.map).find((g) => g.node === f.node)?.items ?? []) : []

  const pci = useHostPci(f.node ?? '', open && kind === 'pci' && showEntries && !!f.node)
  const usb = useHostUsb(f.node ?? '', open && kind === 'usb' && showEntries && !!f.node)
  const choices = useMemo(() => pciChoices(pci.data), [pci.data])

  const globalParams = target.mode === 'global' ? globalMappingParams(target.mapping, f.description, kind === 'pci' ? f : undefined) : null

  function entries(found: Record<string, string>): string[] {
    const node = f.node
    if (!node) {
      found.node = '请选择节点'
      return []
    }
    if (kind === 'pci') {
      const out = pciMapEntries(node, normalizePciSelection(f.pciPaths), choices, previous)
      if (!out.length) found.map = '至少选择一个设备'
      return out
    }
    if (kind === 'usb') {
      const r = usbMapEntry(node, f.usbMode, f.usbValue, usb.data ?? [], previous[0])
      if ('error' in r) {
        found.map = r.error
        return []
      }
      return [r.entry]
    }
    const err = validateDirPath(f.dirPath)
    if (err) {
      found.map = err
      return []
    }
    return [dirMapEntry(node, f.dirPath)]
  }

  async function submit() {
    const found: Record<string, string> = {}
    if (target.mode === 'global') {
      if (globalParams) await mappingWrite(mappingApi.update(kind, target.mapping.id, globalParams), `修改${meta.noun} ${target.mapping.id}`)
      return
    }
    if (target.mode === 'create') {
      const idErr = validateMappingId(f.id)
      if (idErr) found.id = idErr
    }
    const list = entries(found)
    setErrors(found)
    if (Object.keys(found).length) throw new ValidationError()
    if (target.mode === 'create') {
      const params = createMappingParams(f.id, list, f.description, kind === 'pci' ? f : undefined)
      await mappingWrite(mappingApi.create(kind, params), `添加${meta.noun} ${f.id.trim()}`)
      return
    }
    const params = nodeMappingParams(target.mapping, f.node!, list)
    if (params) await mappingWrite(mappingApi.update(kind, target.mapping.id, params), `修改${meta.noun} ${target.mapping.id}`)
  }

  const title =
    target.mode === 'create'
      ? `添加${meta.noun}`
      : target.mode === 'global'
        ? `编辑 ${target.mapping.id}`
        : target.mode === 'node'
          ? `${target.mapping.id} · ${target.node}`
          : `${target.mapping.id}：添加节点`

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={target.mode === 'global' ? meta.title : undefined}
      size={kind === 'pci' && showEntries ? 'lg' : 'md'}
      submitLabel={target.mode === 'create' ? '添加' : '保存'}
      submitDisabled={target.mode === 'global' && !globalParams}
      onSubmit={submit}
    >
      {target.mode === 'create' && (
        <FormField label="名称" name="id" required error={errors.id} hint="虚拟机配置里用这个名字引用映射（mapping=名称）。">
          <FieldInput value={f.id} onChange={(e) => set({ id: e.target.value })} placeholder={kind === 'dir' ? '例如 share' : kind === 'usb' ? '例如 usb-key' : '例如 gpu0'} autoFocus />
        </FormField>
      )}

      {showEntries &&
        (target.mode === 'node' ? (
          <FormField label="节点">
            <p className="text-sm font-medium">{target.node}</p>
          </FormField>
        ) : (
          <FormField label="节点" name="node" required error={errors.node} hint={configured.length ? `已映射：${configured.join('、')}` : undefined}>
            <NodeSelect value={f.node} onValueChange={(node) => set({ node, pciPaths: [] })} exclude={configured} />
          </FormField>
        ))}

      {showEntries && kind === 'pci' && (
        <PciPicker
          node={f.node}
          query={pci}
          choices={choices}
          value={f.pciPaths}
          onChange={(pciPaths) => set({ pciPaths })}
          mdevOnly={f.mdev}
          error={errors.map}
        />
      )}
      {showEntries && kind === 'usb' && (
        <UsbPicker node={f.node} devices={usb.data} loading={usb.isPending && !!f.node} mode={f.usbMode} value={f.usbValue} onChange={set} error={errors.map} />
      )}
      {showEntries && kind === 'dir' && (
        <>
          <FormField label="主机目录" name="map" required error={errors.map} hint="节点上的绝对路径，虚拟机通过 virtiofs 共享它。">
            <FieldInput value={f.dirPath} onChange={(e) => set({ dirPath: e.target.value })} placeholder="/mnt/share" className="font-mono" />
          </FormField>
          <Note>目录需要事先在节点上建好；路径里不能有 ; , = ( ) 这些字符。</Note>
        </>
      )}

      {showGlobal && (
        <>
          {kind === 'pci' && (
            <div className="grid gap-1">
              <SwitchField
                label="用于中介设备（mdev）"
                description="设备提供 vGPU 等中介设备类型；开启后只能选择支持 mdev 的设备。"
                checked={f.mdev}
                onCheckedChange={(mdev) => set({ mdev })}
              />
              <SwitchField
                label="可实时迁移（实验性）"
                description="需要硬件和驱动支持，否则迁移会失败。"
                checked={f.liveMigration}
                onCheckedChange={(liveMigration) => set({ liveMigration })}
              />
            </div>
          )}
          <FormField label="说明" name="description">
            <FieldInput value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="可选" />
          </FormField>
        </>
      )}
    </FormDialog>
  )
}

// ------------------------------------------------------------ PCI picker

function PciPicker({
  node,
  query,
  choices,
  value,
  onChange,
  mdevOnly,
  error,
}: {
  node: string | undefined
  query: ReturnType<typeof useHostPci>
  choices: ReturnType<typeof pciChoices>
  value: string[]
  onChange: (paths: string[]) => void
  mdevOnly: boolean
  error: string | undefined
}) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const visible = choices.filter(
    (c) =>
      (!mdevOnly || c.mdev === 1 || value.includes(c.id)) &&
      (!q || [c.id, c.vendor_name, c.device_name, c.vendor, c.device].some((s) => s?.toLowerCase().includes(q))),
  )
  const selectedSlots = new Set(value.filter((v) => !/\.[0-9a-f]$/i.test(v)))
  const shared = sharedIommuGroups(value, query.data)
  const toggle = (id: string, on: boolean) => onChange(on ? normalizePciSelection([...value, id]) : value.filter((v) => v !== id))
  const nodes = useClusterResources({ select: (all) => all.filter(isNode).length })

  return (
    <FormField label="设备" name="map" required error={error} hint={value.length ? `已选 ${value.length} 个` : '可以多选；同型号的多块卡登记在一起，启动虚拟机时自动用第一块空闲的。'}>
      <div className="grid gap-2">
        {iommuMissing(query.data) && <Note tone="warning">这个节点没有检测到 IOMMU，PCI 直通需要先在 BIOS 和内核参数里开启它。</Note>}
        {value.length > 1 && <Note>选择多个设备时，启动虚拟机会使用第一个空闲的设备。</Note>}
        {shared.length > 0 && <Note tone="warning">{shared.join('、')} 和未选择的设备在同一个 IOMMU 组，直通时整个组会一起交给虚拟机，请确认这是预期的。</Note>}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 ID、厂商或设备名" aria-label="搜索 PCI 设备" className="pl-9" />
        </div>
        {!node ? (
          <p className="rounded-xl border border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">先选择节点</p>
        ) : query.isPending ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : query.isError ? (
          <p className="rounded-xl border border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">无法读取 {node} 的 PCI 设备列表。</p>
        ) : (
          <ul aria-label="PCI 设备" className="divide-y divide-border/60 sm:max-h-80 sm:overflow-y-auto rounded-xl border border-border/70">
            {visible.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">{mdevOnly ? '没有支持中介设备（mdev）的设备' : '没有匹配的设备'}</li>
            )}
            {visible.map((c) => {
              const covered = !c.slot && selectedSlots.has(c.id.replace(/\.[0-9a-f]$/i, ''))
              const checked = covered || value.includes(c.id)
              const name = c.slot ? '整个设备（所有功能一起直通）' : [c.vendor_name, c.device_name].filter(Boolean).join(' ') || `${c.vendor}:${c.device}`
              return (
                <li key={c.id}>
                  <label
                    className={cn(
                      'flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-foreground/[0.03]',
                      covered && 'cursor-default opacity-60',
                      !c.slot && c.functions > 1 && 'pl-7',
                    )}
                    data-pci={c.id}
                  >
                    <Checkbox checked={checked} disabled={covered} onCheckedChange={(v) => toggle(c.id, v === true)} aria-label={`${c.id} ${name}`} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                        <span className="font-mono text-[13px]">{c.id}</span>
                        <span className="min-w-0 truncate text-sm">{name}</span>
                      </span>
                      <span className="flex flex-wrap gap-x-3 font-mono text-[11px] text-muted-foreground">
                        <span>{c.iommugroup === -1 ? 'IOMMU 组 -' : `IOMMU 组 ${c.iommugroup}`}</span>
                        {!c.slot && <span>{`${c.vendor}:${c.device}`.replace(/0x/g, '')}</span>}
                        {c.mdev === 1 && <span className="text-brand-strong">mdev</span>}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        {nodes.data !== undefined && nodes.data > 1 && <p className="text-xs text-muted-foreground">其他节点的设备在保存后用“添加节点映射”继续登记。</p>}
      </div>
    </FormField>
  )
}

// ------------------------------------------------------------ USB picker

function UsbPicker({
  node,
  devices,
  loading,
  mode,
  value,
  onChange,
  error,
}: {
  node: string | undefined
  devices: HostUsbDevice[] | undefined
  loading: boolean
  mode: UsbMode
  value: string
  onChange: (patch: Partial<Form>) => void
  error: string | undefined
}) {
  const list = (devices ?? []).filter((d) => d.class !== 9 && (mode === 'id' || usbPortPath(d)))
  const keyOf = (d: HostUsbDevice) => (mode === 'id' ? usbDeviceId(d) : usbPortPath(d)!)
  return (
    <div className="grid gap-3">
      <FormField label="匹配方式">
        <ToggleGroup
          type="single"
          variant="outline"
          value={mode}
          onValueChange={(v) => v && onChange({ usbMode: v as UsbMode, usbValue: '' })}
          aria-label="匹配方式"
          className="grid w-full grid-cols-2"
        >
          <ToggleGroupItem value="id" className="pointer-coarse:h-10">
            按设备 ID
          </ToggleGroupItem>
          <ToggleGroupItem value="path" className="pointer-coarse:h-10">
            按 USB 端口
          </ToggleGroupItem>
        </ToggleGroup>
      </FormField>
      <FormField
        label={mode === 'id' ? '设备 ID' : 'USB 端口'}
        name="map"
        required
        error={error}
        hint={mode === 'id' ? '厂商ID:产品ID，同型号设备插在哪个口都能匹配。' : '总线-端口，插在这个口上的设备会被直通。'}
      >
        <FieldInput value={value} onChange={(e) => onChange({ usbValue: e.target.value })} placeholder={mode === 'id' ? '046d:c52b' : '1-2.3'} className="font-mono" />
      </FormField>
      <div className="grid gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">{node ? `${node} 上的 USB 设备` : '先选择节点'}</p>
        {node &&
          (loading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : list.length === 0 ? (
            <p className="rounded-xl border border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">没有检测到 USB 设备，可以手动填写。</p>
          ) : (
            <ul aria-label="USB 设备" className="divide-y divide-border/60 sm:max-h-60 sm:overflow-y-auto rounded-xl border border-border/70">
              {list.map((d) => {
                const key = keyOf(d)
                const picked = key === value.trim().toLowerCase()
                return (
                  <li key={`${d.busnum}-${d.devnum}`}>
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => onChange({ usbValue: key })}
                      className={cn(
                        'flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05]',
                        picked && 'bg-brand/8 paper:bg-secondary',
                      )}
                    >
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate text-sm">{[d.manufacturer, d.product].filter(Boolean).join(' ') || '未知设备'}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {usbDeviceId(d)}
                          {usbPortPath(d) && ` · 端口 ${usbPortPath(d)}`}
                        </span>
                      </span>
                      {picked && <span className="text-xs text-brand-strong">已选</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          ))}
      </div>
    </div>
  )
}
