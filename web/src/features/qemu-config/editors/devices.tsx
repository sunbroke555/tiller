// Editors for network devices and the other devices: USB, PCI, serial,
// audio, VirtIO RNG and virtiofs.

import { useMemo, useState } from 'react'

import { useHostPci, useHostUsb, useMappings, usePciMdev } from '@/api/qemu-config'
import {
  BridgeSelect,
  FieldInput,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NumberInput,
  SelectField,
  SwitchField,
} from '@/components/form'
import { parseQemuNet, QEMU_NIC_MODELS, tryParsePropertyString } from '@/lib/propstring'

import { AUDIO_DEVICES, HW_MAX, NIC_MODEL_LABEL, RNG_SOURCES } from '../constants'
import { useQemuConfig, useSaveConfig, type DialogRenderProps } from '../context'
import { maxUsbCount, nextFreeKey } from '../model'
import {
  netValue,
  parseUsb,
  pciFormFrom,
  pciValue,
  rngValue,
  updateParams,
  usbValue,
  virtiofsValue,
  type NetForm,
  type PciForm,
  type UsbMode,
  type VirtiofsForm,
} from '../params'
import { SearchSelect, type SearchOption } from '../pickers'
import { Hint, Segmented } from '../ui'

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i

/** Save helper for single-key device rows: edit → only changed, add → new key. */
function deviceParams(
  cfg: Record<string, string>,
  key: string | undefined,
  value: string | undefined,
  digest: string | undefined,
  editing: boolean,
) {
  if (!key || value === undefined) return null
  return editing ? updateParams(cfg, { [key]: value }, digest) : { [key]: value, digest }
}

// --------------------------------------------------------------- network

export function NetworkDialog({ confid, ...props }: DialogRenderProps & { confid?: string }) {
  const { cfg, digest, node } = useQemuConfig()
  const save = useSaveConfig()
  const editing = !!confid
  const key = confid ?? nextFreeKey(cfg, 'net', HW_MAX.net)
  const net = parseQemuNet(confid ? cfg[confid] : undefined)
  const [f, setF] = useState<NetForm>(() => ({
    model: net?.model ?? (cfg.ostype === 'l26' || !cfg.ostype || cfg.ostype === 'other' ? 'virtio' : 'e1000'),
    macaddr: net?.macaddr ?? '',
    bridge: net?.options.bridge,
    tag: net?.options.tag ? Number(net.options.tag) : undefined,
    firewall: net ? net.options.firewall === '1' : true,
    disconnect: net?.options.link_down === '1',
    rate: net?.options.rate ? Number(net.options.rate) : undefined,
    queues: net?.options.queues ? Number(net.options.queues) : undefined,
    mtu: net?.options.mtu ? Number(net.options.mtu) : undefined,
    trunks: (net?.options.trunks ?? '').replace(/;/g, ','),
  }))
  const set = (patch: Partial<NetForm>) => setF((v) => ({ ...v, ...patch }))
  const macInvalid = f.macaddr.trim() !== '' && !MAC_RE.test(f.macaddr.trim())
  const mtuInvalid = f.mtu !== undefined && f.mtu !== 1 && f.mtu < 576
  const value = f.bridge ? netValue(net?.options ?? {}, f) : undefined
  const params = deviceParams(cfg, key, value, digest, editing)
  const models = useMemo(() => {
    const list: string[] = [...QEMU_NIC_MODELS]
    return list.map((m) => ({ value: m, label: NIC_MODEL_LABEL[m] ?? m }))
  }, [])

  return (
    <FormDialog
      {...props}
      size="lg"
      title={editing ? `网络设备 (${confid})` : '添加网络设备'}
      submitLabel={editing ? '保存' : '添加'}
      submitDisabled={!params || macInvalid || mtuInvalid || !key}
      onSubmit={() => save(params, { title: editing ? `修改网络设备 ${confid}` : `添加网络设备 ${key}` })}
    >
      <FormRow>
        <FormField label="网桥" name="bridge" required>
          <BridgeSelect node={node} value={f.bridge} onValueChange={(bridge) => set({ bridge })} />
        </FormField>
        <FormField label="VLAN 标签" name="tag" hint="1–4094，留空不打标签">
          <NumberInput value={f.tag} onChange={(tag) => set({ tag })} min={1} max={4094} placeholder="无 VLAN" />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="型号" name="model">
          <SelectField value={f.model} onValueChange={(model) => model && set({ model })} options={models} />
        </FormField>
        <FormField label="MAC 地址" name="macaddr" error={macInvalid ? '格式：BC:24:11:AA:BB:CC' : undefined}>
          <FieldInput
            value={f.macaddr}
            onChange={(e) => set({ macaddr: e.target.value })}
            placeholder="自动生成"
            className="font-mono"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </FormField>
      </FormRow>
      <SwitchField label="防火墙" description="对这块网卡应用虚拟机防火墙规则" checked={f.firewall} onCheckedChange={(firewall) => set({ firewall })} />
      <FormSection collapsible title="高级选项" defaultOpen={!!(f.disconnect || f.rate || f.queues || f.mtu || f.trunks)}>
        <SwitchField label="断开连接" description="模拟拔掉网线（link_down）" checked={f.disconnect} onCheckedChange={(disconnect) => set({ disconnect })} />
        <FormRow>
          <FormField label="限速" name="rate">
            <NumberInput value={f.rate} onChange={(rate) => set({ rate })} min={0} max={10240} decimal unit="MB/s" placeholder="不限" />
          </FormField>
          <FormField label="多队列" name="queues" hint="建议与 vCPU 数相同">
            <NumberInput value={f.queues} onChange={(queues) => set({ queues })} min={1} max={64} placeholder="无" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField
            label="MTU"
            name="mtu"
            hint={f.model === 'virtio' ? '填 1 表示继承网桥的 MTU' : '仅 VirtIO 支持'}
            error={mtuInvalid ? 'MTU 需要 ≥ 576，或填 1 继承网桥' : undefined}
            disabled={f.model !== 'virtio'}
          >
            <NumberInput value={f.mtu} onChange={(mtu) => set({ mtu })} min={1} max={65520} placeholder="与网桥相同" disabled={f.model !== 'virtio'} />
          </FormField>
          <FormField label="VLAN Trunks" name="trunks" hint="允许通过的 VLAN，例如 10,20-30">
            <FieldInput value={f.trunks} onChange={(e) => set({ trunks: e.target.value })} placeholder="全部" inputMode="numeric" />
          </FormField>
        </FormRow>
      </FormSection>
    </FormDialog>
  )
}

// ------------------------------------------------------------------- USB

export function UsbDialog({ confid, ...props }: DialogRenderProps & { confid?: string }) {
  const { cfg, digest, node, can } = useQemuConfig()
  const save = useSaveConfig()
  const editing = !!confid
  const key = confid ?? nextFreeKey(cfg, 'usb', maxUsbCount(cfg))
  const initial = parseUsb(confid ? cfg[confid] : undefined)
  const [mode, setMode] = useState<UsbMode>(initial.mode)
  const [id, setId] = useState<string | undefined>(initial.id || undefined)
  const [usb3, setUsb3] = useState(initial.usb3)
  const hostAllowed = can('Sys.Console', 'nodes')
  const usb = useHostUsb(node, hostAllowed && (mode === 'device' || mode === 'port'))
  const maps = useMappings('usb', node, mode === 'mapped')
  const modern = maxUsbCount(cfg) > HW_MAX.usbOld

  const options = useMemo<SearchOption[]>(() => {
    if (mode === 'mapped') {
      return (maps.data ?? []).map((m) => ({
        value: m.id,
        label: m.id,
        description: m.checks?.length ? '此节点不可用' : m.description,
      }))
    }
    const devices = (usb.data ?? []).filter((d) => !!d.usbpath && !!d.prodid && String(d.class) !== '9')
    return devices.map((d) => {
      const value = mode === 'device' ? `${d.vendid}:${d.prodid}` : `${d.busnum}-${d.usbpath}`
      return {
        value,
        label: `${d.product ?? (mode === 'device' ? '未知设备' : '未插入')} (${value})`,
        description: [d.manufacturer, speedLabel(d.speed)].filter(Boolean).join(' · '),
      }
    })
  }, [mode, usb.data, maps.data])

  const idInvalid =
    (mode === 'device' && !!id && !/^[0-9a-f]{4}:[0-9a-f]{4}$/i.test(id)) ||
    (mode === 'port' && !!id && !/^\d+-\d+(\.\d+)*$/.test(id))
  const value = mode === 'spice' || id ? usbValue(mode, id, modern ? false : usb3) : undefined
  const params = deviceParams(cfg, key, value, digest, editing)

  return (
    <FormDialog
      {...props}
      title={editing ? `USB 设备 (${confid})` : '添加 USB 设备'}
      submitLabel={editing ? '保存' : '添加'}
      submitDisabled={!params || idInvalid || !key}
      onSubmit={() => save(params, { title: editing ? `修改 USB 设备 ${confid}` : `添加 USB 设备 ${key}` })}
    >
      {!key && <Hint tone="warning">已达到 USB 设备数量上限。</Hint>}
      <FormField label="类型">
        <Segmented
          aria-label="USB 类型"
          value={mode}
          onValueChange={(m) => {
            setMode(m)
            setId(undefined)
          }}
          options={[
            { value: 'spice', label: 'SPICE' },
            { value: 'mapped', label: '映射' },
            { value: 'device', label: '设备 ID', disabled: !hostAllowed },
            { value: 'port', label: '端口', disabled: !hostAllowed },
          ]}
        />
      </FormField>
      {mode === 'spice' ? (
        <Hint>把 SPICE 客户端的 USB 设备重定向到虚拟机（需要 SPICE 显示）。</Hint>
      ) : (
        <FormField
          label={mode === 'mapped' ? '映射的设备' : mode === 'device' ? '设备（厂商:产品 ID）' : '端口（总线-端口）'}
          name={key}
          required
          error={idInvalid ? (mode === 'device' ? '格式：1234:abcd' : '格式：1-2.3') : undefined}
          hint={
            mode === 'mapped'
              ? '在 数据中心 → 资源映射 中管理 USB 映射。'
              : mode === 'device'
                ? '按厂商/产品 ID 直通，设备换口后仍然有效。'
                : '直通整个物理端口，插到这个口的任何设备都会给虚拟机。'
          }
        >
          <SearchSelect
            value={id}
            onValueChange={setId}
            options={options}
            loading={mode === 'mapped' ? maps.isPending : usb.isPending}
            allowCustom={mode !== 'mapped'}
            placeholder={options.length === 0 && !(mode === 'mapped' ? maps.isPending : usb.isPending) ? '没有可用设备，可直接输入' : '选择设备'}
          />
        </FormField>
      )}
      <SwitchField
        label="USB 3"
        description={modern ? '新机器版本始终使用 xHCI 控制器' : '使用 USB 3 (xHCI) 控制器'}
        checked={modern ? true : usb3}
        disabled={modern}
        onCheckedChange={setUsb3}
      />
    </FormDialog>
  )
}

function speedLabel(speed: string | undefined): string | undefined {
  const map: Record<string, string> = { '10000': 'USB 3.1', '5000': 'USB 3.0', '480': 'USB 2.0', '12': 'USB 1.x', '1.5': 'USB 1.x' }
  return speed ? (map[speed] ?? `${speed} Mbps`) : undefined
}

// ------------------------------------------------------------------- PCI

export function PciDialog({ confid, ...props }: DialogRenderProps & { confid?: string }) {
  const { cfg, digest, node, can } = useQemuConfig()
  const save = useSaveConfig()
  const editing = !!confid
  const key = confid ?? nextFreeKey(cfg, 'hostpci', HW_MAX.hostpci)
  const [f, setF] = useState<PciForm>(() => pciFormFrom(confid ? cfg[confid] : undefined))
  const set = (patch: Partial<PciForm>) => setF((v) => ({ ...v, ...patch }))
  const rawAllowed = can('Sys.Console', 'nodes')
  const pci = useHostPci(node, rawAllowed && f.mode === 'raw')
  const maps = useMappings('pci', node, f.mode === 'mapped')
  const q35 = (cfg.machine ?? '').includes('q35')
  const selectedDevice = f.mode === 'raw' ? pci.data?.find((d) => d.id === f.host) : undefined
  const mdevSource = f.mode === 'raw' ? (selectedDevice?.mdev ? f.host : undefined) : f.mapping
  const mdevs = usePciMdev(node, f.mode === 'mapped' ? undefined : mdevSource)
  const noIommu = !!pci.data?.length && pci.data.every((d) => d.iommugroup === -1)
  const sharedGroup =
    !!selectedDevice &&
    selectedDevice.iommugroup !== -1 &&
    (pci.data ?? []).some((d) => d.iommugroup === selectedDevice.iommugroup && d.id.slice(0, 7) !== selectedDevice.id.slice(0, 7))

  const pciOptions = useMemo<SearchOption[]>(
    () =>
      (pci.data ?? []).map((d) => ({
        value: d.id,
        label: `${d.id.replace(/^0000:/, '')} ${d.device_name ?? d.device}`,
        description: [d.vendor_name ?? d.vendor, d.iommugroup >= 0 ? `IOMMU ${d.iommugroup}` : null, d.mdev ? 'mdev' : null]
          .filter(Boolean)
          .join(' · '),
        keywords: [d.vendor, d.device, d.class],
      })),
    [pci.data],
  )
  const idOk = (v: string) => v === '' || /^0x[0-9a-f]{4}$/i.test(v)
  const idsInvalid = ![f.vendorId, f.deviceId, f.subVendorId, f.subDeviceId].every((v) => idOk(v.trim()))
  const ready = f.mode === 'raw' ? !!f.host : !!f.mapping
  const value = ready ? pciValue(confid ? cfg[confid] : undefined, f) : undefined
  const params = deviceParams(cfg, key, value, digest, editing)

  return (
    <FormDialog
      {...props}
      size="lg"
      title={editing ? `PCI 设备 (${confid})` : '添加 PCI 设备'}
      submitLabel={editing ? '保存' : '添加'}
      submitDisabled={!params || idsInvalid || !key}
      onSubmit={() => save(params, { title: editing ? `修改 PCI 设备 ${confid}` : `添加 PCI 设备 ${key}` })}
    >
      <FormField label="设备来源">
        <Segmented
          aria-label="设备来源"
          value={f.mode}
          onValueChange={(mode) => set({ mode, mdev: undefined })}
          options={[
            { value: 'mapped', label: '映射的设备' },
            { value: 'raw', label: '原始设备', disabled: !rawAllowed },
          ]}
        />
      </FormField>
      {f.mode === 'mapped' ? (
        <FormField label="设备" name={key} required hint="在 数据中心 → 资源映射 中管理 PCI 映射；映射的设备可以跨节点迁移。">
          <SearchSelect
            value={f.mapping}
            onValueChange={(mapping) => set({ mapping, mdev: undefined })}
            loading={maps.isPending}
            placeholder={maps.data?.length === 0 ? '没有 PCI 映射' : '选择映射'}
            options={(maps.data ?? []).map((m) => ({ value: m.id, label: m.id, description: m.checks?.length ? '此节点不可用' : m.description }))}
          />
        </FormField>
      ) : (
        <>
          {noIommu && <Hint tone="warning">没有检测到 IOMMU，请先在宿主机上启用（intel_iommu=on / amd_iommu）。</Hint>}
          <FormField label="设备" name={key} required>
            <SearchSelect
              value={f.host}
              onValueChange={(host) => set({ host, mdev: undefined })}
              options={pciOptions}
              loading={pci.isPending}
              searchPlaceholder="搜索地址、厂商或设备…"
            />
          </FormField>
          {sharedGroup && <Hint tone="warning">所选设备和其他设备在同一个 IOMMU 组中，确认这是你想要的。</Hint>}
          <SwitchField
            label="全部功能"
            description="直通设备的所有功能（如显卡的音频部分）"
            checked={f.allFunctions}
            disabled={!!f.mdev}
            onCheckedChange={(allFunctions) => set({ allFunctions })}
          />
        </>
      )}
      {(mdevs.data?.length ?? 0) > 0 && (
        <FormField label="MDev 类型" name="mdev" hint="把设备切分为多个虚拟设备（如 vGPU）">
          <SelectField
            value={f.mdev}
            onValueChange={(mdev) => set({ mdev, allFunctions: mdev ? false : f.allFunctions })}
            emptyOption="不使用"
            options={(mdevs.data ?? []).map((m) => ({ value: m.type, label: m.name ?? m.type, description: `可用 ${m.available}` }))}
          />
        </FormField>
      )}
      <SwitchField label="主 GPU" description="作为虚拟机的主显卡（x-vga）" checked={f.primaryGpu} onCheckedChange={(primaryGpu) => set({ primaryGpu })} />
      <FormSection collapsible title="高级选项" defaultOpen={!!(f.pcie || !f.rombar || f.vendorId || f.deviceId || f.subVendorId || f.subDeviceId)}>
        <SwitchField
          label="PCI-Express"
          description={q35 ? '以 PCIe 设备接入' : '仅 q35 机器类型可用'}
          checked={f.pcie && q35}
          disabled={!q35}
          onCheckedChange={(pcie) => set({ pcie })}
        />
        <SwitchField label="ROM-Bar" description="让客户机可以看到设备的 ROM" checked={f.rombar} onCheckedChange={(rombar) => set({ rombar })} />
        <FormRow>
          <FormField label="厂商 ID" name="vendor-id" error={idOk(f.vendorId.trim()) ? undefined : '格式：0x8086'}>
            <FieldInput value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })} placeholder="来自设备" className="font-mono" />
          </FormField>
          <FormField label="设备 ID" name="device-id" error={idOk(f.deviceId.trim()) ? undefined : '格式：0x1234'}>
            <FieldInput value={f.deviceId} onChange={(e) => set({ deviceId: e.target.value })} placeholder="来自设备" className="font-mono" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="子厂商 ID" name="sub-vendor-id" error={idOk(f.subVendorId.trim()) ? undefined : '格式：0x8086'}>
            <FieldInput value={f.subVendorId} onChange={(e) => set({ subVendorId: e.target.value })} placeholder="来自设备" className="font-mono" />
          </FormField>
          <FormField label="子设备 ID" name="sub-device-id" error={idOk(f.subDeviceId.trim()) ? undefined : '格式：0x1234'}>
            <FieldInput value={f.subDeviceId} onChange={(e) => set({ subDeviceId: e.target.value })} placeholder="来自设备" className="font-mono" />
          </FormField>
        </FormRow>
      </FormSection>
      <Hint>直通 PCI 设备后，虚拟机不能实时迁移（除非映射标记为支持实时迁移）。</Hint>
    </FormDialog>
  )
}

// ---------------------------------------------------------------- serial

export function SerialDialog({ confid, ...props }: DialogRenderProps & { confid?: string }) {
  const { cfg, digest, isRoot } = useQemuConfig()
  const save = useSaveConfig()
  const editing = !!confid
  const [index, setIndex] = useState<number | undefined>(() => {
    const k = confid ?? nextFreeKey(cfg, 'serial', HW_MAX.serial)
    return k ? Number(k.slice(6)) : undefined
  })
  const current = confid ? cfg[confid] : undefined
  const [kind, setKind] = useState<'socket' | 'device'>(current && current !== 'socket' ? 'device' : 'socket')
  const [path, setPath] = useState(current && current !== 'socket' ? current : '/dev/ttyS0')
  const key = confid ?? (index !== undefined ? `serial${index}` : undefined)
  const taken = !editing && !!key && cfg[key] !== undefined
  const pathInvalid = kind === 'device' && !/^\/dev\/.+/.test(path.trim())
  const value = kind === 'socket' ? 'socket' : path.trim()
  const params = taken ? null : deviceParams(cfg, key, value, digest, editing)
  return (
    <FormDialog
      {...props}
      size="sm"
      title={editing ? `串口 (${confid})` : '添加串口'}
      submitLabel={editing ? '保存' : '添加'}
      submitDisabled={!params || pathInvalid}
      onSubmit={() => save(params, { title: editing ? `修改串口 ${confid}` : `添加串口 ${key}` })}
    >
      {!editing && (
        <FormField label="串口编号" name={key} error={taken ? `${key} 已存在` : undefined}>
          <NumberInput value={index} onChange={setIndex} min={0} max={3} stepper />
        </FormField>
      )}
      <FormField label="类型">
        <Segmented
          aria-label="串口类型"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: 'socket', label: 'Socket' },
            { value: 'device', label: '宿主机设备', disabled: !isRoot },
          ]}
        />
      </FormField>
      {kind === 'socket' ? (
        <Hint>Socket 串口可以在“控制台”里用 xterm.js 连接；显示设为“串口终端”时作为主控制台。</Hint>
      ) : (
        <FormField label="设备路径" error={pathInvalid ? '需要以 /dev/ 开头' : undefined} hint="直通宿主机的串口设备（仅 root）">
          <FieldInput value={path} onChange={(e) => setPath(e.target.value)} className="font-mono" placeholder="/dev/ttyS0" />
        </FormField>
      )}
    </FormDialog>
  )
}

// ----------------------------------------------------------------- audio

export function AudioDialog({ confid, ...props }: DialogRenderProps & { confid?: string }) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const editing = !!confid
  const a = tryParsePropertyString(cfg.audio0, 'device')
  const [device, setDevice] = useState(a.device ?? 'ich9-intel-hda')
  const [driver, setDriver] = useState(a.driver ?? 'spice')
  const value = `device=${device},driver=${driver}`
  const params = deviceParams(cfg, 'audio0', value, digest, editing)
  return (
    <FormDialog
      {...props}
      size="sm"
      title={editing ? '音频设备' : '添加音频设备'}
      submitLabel={editing ? '保存' : '添加'}
      submitDisabled={!params}
      onSubmit={() => save(params, { title: editing ? '修改音频设备' : '添加音频设备' })}
    >
      <FormField label="设备" name="audio0">
        <SelectField value={device} onValueChange={(v) => v && setDevice(v)} options={AUDIO_DEVICES.map((d) => ({ value: d, label: d }))} />
      </FormField>
      <FormField label="后端驱动" hint="SPICE 把声音传给 SPICE 客户端；“无”只模拟一个设备。">
        <SelectField
          value={driver}
          onValueChange={(v) => v && setDriver(v)}
          options={[
            { value: 'spice', label: 'SPICE' },
            { value: 'none', label: '无（模拟设备）' },
          ]}
        />
      </FormField>
    </FormDialog>
  )
}

// ------------------------------------------------------------------- RNG

export function RngDialog({ confid, ...props }: DialogRenderProps & { confid?: string }) {
  const { cfg, digest, isRoot } = useQemuConfig()
  const save = useSaveConfig()
  const editing = !!confid
  const r = tryParsePropertyString(cfg.rng0, 'source')
  const [source, setSource] = useState(r.source ?? '/dev/urandom')
  const [maxBytes, setMaxBytes] = useState<number | undefined>(
    r.max_bytes === '0' ? undefined : r.max_bytes ? Number(r.max_bytes) : 1024,
  )
  const [period, setPeriod] = useState<number | undefined>(r.period ? Number(r.period) : undefined)
  const value = rngValue(source, maxBytes, period)
  const params = deviceParams(cfg, 'rng0', value, digest, editing)
  return (
    <FormDialog
      {...props}
      title={editing ? 'VirtIO RNG' : '添加 VirtIO RNG'}
      description="给客户机提供宿主机的随机数源，加快熵的收集。"
      submitLabel={editing ? '保存' : '添加'}
      submitDisabled={!params}
      onSubmit={() => save(params, { title: editing ? '修改 VirtIO RNG' : '添加 VirtIO RNG' })}
    >
      <FormField label="熵源" name="source">
        <SelectField
          value={source}
          onValueChange={(v) => v && setSource(v)}
          options={RNG_SOURCES.map((s) => ({
            value: s,
            label: s,
            description: s === '/dev/hwrng' ? (isRoot ? '硬件随机数' : '仅 root') : s === '/dev/random' ? '可能阻塞' : '推荐',
            disabled: s === '/dev/hwrng' && !isRoot,
          }))}
        />
      </FormField>
      <FormRow>
        <FormField label="限制" name="max_bytes" hint="每个周期最多读取的字节数">
          <NumberInput value={maxBytes} onChange={setMaxBytes} min={0} unit="字节" placeholder="不限" />
        </FormField>
        <FormField label="周期" name="period">
          <NumberInput value={period} onChange={setPeriod} min={1} unit="ms" placeholder="默认 (1000)" />
        </FormField>
      </FormRow>
      {maxBytes === undefined && <Hint tone="warning">关闭限制后，客户机可能耗尽宿主机的熵，请谨慎使用。</Hint>}
    </FormDialog>
  )
}

// -------------------------------------------------------------- virtiofs

export function VirtiofsDialog({ confid, ...props }: DialogRenderProps & { confid?: string }) {
  const { cfg, digest, node } = useQemuConfig()
  const save = useSaveConfig()
  const editing = !!confid
  const key = confid ?? nextFreeKey(cfg, 'virtiofs', HW_MAX.virtiofs)
  const v = tryParsePropertyString(confid ? cfg[confid] : undefined, 'dirid')
  const [f, setF] = useState<VirtiofsForm>({
    dirid: v.dirid ?? '',
    cache: v.cache,
    xattr: v['expose-xattr'] === '1',
    acl: v['expose-acl'] === '1',
    directIo: v['direct-io'] === '1',
  })
  const set = (patch: Partial<VirtiofsForm>) => setF((x) => ({ ...x, ...patch }))
  const maps = useMappings('dir', node)
  const value = f.dirid ? virtiofsValue(f) : undefined
  const params = deviceParams(cfg, key, value, digest, editing)
  return (
    <FormDialog
      {...props}
      title={editing ? `Virtiofs (${confid})` : '添加 Virtiofs'}
      description="把集群目录映射共享给虚拟机，客户机里用 mount -t virtiofs 挂载。"
      submitLabel={editing ? '保存' : '添加'}
      submitDisabled={!params || !key}
      onSubmit={() => save(params, { title: editing ? `修改 ${confid}` : `添加 ${key}` })}
    >
      <FormField label="目录映射" name="dirid" required hint="在 数据中心 → 资源映射 → 目录 中管理。">
        <SearchSelect
          value={f.dirid || undefined}
          onValueChange={(dirid) => set({ dirid: dirid ?? '' })}
          loading={maps.isPending}
          placeholder={maps.data?.length === 0 ? '还没有目录映射' : '选择映射'}
          options={(maps.data ?? []).map((m) => ({ value: m.id, label: m.id, description: m.checks?.length ? '此节点不可用' : m.description }))}
        />
      </FormField>
      <FormSection collapsible title="高级选项" defaultOpen={!!(f.cache || f.xattr || f.acl || f.directIo)}>
        <FormField label="缓存" name="cache">
          <SelectField
            value={f.cache}
            onValueChange={(cache) => set({ cache })}
            emptyOption="默认 (auto)"
            options={['auto', 'always', 'metadata', 'never'].map((c) => ({ value: c, label: c }))}
          />
        </FormField>
        <SwitchField label="xattr 支持" description="支持扩展属性" checked={f.xattr || f.acl} disabled={f.acl} onCheckedChange={(xattr) => set({ xattr })} />
        <SwitchField label="POSIX ACL" description="隐含 xattr 支持" checked={f.acl} onCheckedChange={(acl) => set({ acl })} />
        <SwitchField label="允许 Direct IO" checked={f.directIo} onCheckedChange={(directIo) => set({ directIo })} />
      </FormSection>
    </FormDialog>
  )
}
