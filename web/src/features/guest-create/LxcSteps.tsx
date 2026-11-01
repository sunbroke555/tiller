// Steps of the container creation wizard. FormField `name`s are the API
// parameter names so PVE's field errors land under the right control.

import { useRef, useState } from 'react'
import { Eye, EyeOff, FileKey, FolderInput, Globe, HardDrive, Plus, ShieldCheck, Trash2, Wifi, WifiOff } from 'lucide-react'

import { useClusterResources, useClusterStatus, useNodeStorages } from '@/api/queries'
import { isNode } from '@/api/types'
import {
  BridgeSelect,
  FieldInput,
  FieldTextarea,
  FormField,
  FormRow,
  FormSection,
  NodeSelect,
  NumberInput,
  SelectField,
  SizeInput,
  StorageSelect,
  SwitchField,
  VmidInput,
  type VmidValidity,
} from '@/components/form'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/format'

import { ChipToggles, ChoiceCards, PoolSelect, TagInput, TemplateShortcut, VolumeSelect } from './fields'
import {
  MOUNT_OPTIONS,
  ROOTFS_MOUNT_OPTIONS,
  freeMpIndexes,
  newMountPoint,
  quotaAllowed,
  type AclMode,
  type Ipv4Mode,
  type Ipv6Mode,
  type LxcForm,
  type LxcMountPoint,
} from './lxc'
import { MemoryPresets } from './QemuSteps'

export interface LxcStepProps {
  form: LxcForm
  set: (patch: Partial<LxcForm>) => void
  update: (fn: (f: LxcForm) => LxcForm) => void
}

const ACL_OPTIONS = [
  { value: '1', label: '启用' },
  { value: '0', label: '禁用' },
]

function useNodeInfo(node: string) {
  const { data } = useClusterResources({ select: (all) => all.filter(isNode).find((n) => n.node === node) })
  return data
}

function OptionalNumber(props: {
  label: string
  name?: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  placeholder: string
  unit?: string
  min?: number
  max?: number
  decimal?: boolean
  hint?: string
}) {
  return (
    <FormField label={props.label} name={props.name} hint={props.hint}>
      <NumberInput
        value={props.value}
        onChange={props.onChange}
        placeholder={props.placeholder}
        unit={props.unit}
        min={props.min}
        max={props.max}
        decimal={props.decimal}
      />
    </FormField>
  )
}

function PasswordInput({ value, onChange, autoComplete }: { value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <FieldInput type={visible ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} className="pr-11" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

// --------------------------------------------------------------- general

export function LxcGeneralStep({ form, set, onVmidValidity }: LxcStepProps & { onVmidValidity: (v: VmidValidity) => void }) {
  const { data: status } = useClusterStatus()
  const inCluster = !!status?.some((e) => e.type === 'cluster')
  const fileRef = useRef<HTMLInputElement>(null)

  const loadKeys = async (files: FileList | null) => {
    if (!files?.length) return
    const texts = await Promise.all([...files].map((f) => f.text()))
    const added = texts.map((t) => t.trim()).filter(Boolean)
    set({ sshKeys: [form.sshKeys.trim(), ...added].filter(Boolean).join('\n') })
  }

  return (
    <div className="grid gap-5">
      <TemplateShortcut type="lxc" />
      <FormRow>
        <FormField label="节点" name="node" required>
          <NodeSelect value={form.node} onValueChange={(node) => set({ node: node ?? '' })} />
        </FormField>
        <FormField label="CT ID" name="vmid" required>
          <VmidInput value={form.vmid} onChange={(vmid) => set({ vmid })} onValidityChange={onVmidValidity} />
        </FormField>
      </FormRow>
      <FormField label="主机名" name="hostname" hint="可选，例如 web-01。留空时为 CT<ID>。">
        <FieldInput value={form.hostname} onChange={(e) => set({ hostname: e.target.value })} placeholder="未命名" autoCapitalize="none" spellCheck={false} />
      </FormField>
      <div className="grid gap-1">
        <SwitchField
          label="非特权容器"
          description="容器内的 root 映射为主机上的普通用户，更安全。推荐保持开启。"
          checked={form.unprivileged}
          onCheckedChange={(unprivileged) => set({ unprivileged })}
        />
        <SwitchField
          label="嵌套"
          description={form.unprivileged ? '允许容器内运行 systemd 新版功能、Docker 等' : '仅非特权容器可在创建时开启'}
          checked={form.unprivileged && form.nesting}
          disabled={!form.unprivileged}
          onCheckedChange={(nesting) => set({ nesting })}
        />
      </div>

      <FormSection title="root 认证" description="设置密码或 SSH 公钥，至少一项。">
        <FormRow>
          <FormField label="密码" name="password">
            <PasswordInput value={form.password} onChange={(password) => set({ password })} autoComplete="new-password" />
          </FormField>
          <FormField label="确认密码" name="confirmPassword">
            <PasswordInput value={form.confirmPassword} onChange={(confirmPassword) => set({ confirmPassword })} autoComplete="new-password" />
          </FormField>
        </FormRow>
        <FormField
          label="SSH 公钥"
          name="ssh-public-keys"
          labelExtra={
            <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} className="-my-1 h-7 gap-1 text-xs pointer-coarse:h-9">
              <FileKey className="size-3.5" /> 从文件导入
            </Button>
          }
          hint="每行一个，例如 ssh-ed25519 AAAA… user@host"
        >
          <FieldTextarea
            value={form.sshKeys}
            onChange={(e) => set({ sshKeys: e.target.value })}
            placeholder="ssh-ed25519 AAAA…"
            spellCheck={false}
            autoCapitalize="none"
            className="min-h-20 font-mono text-base md:text-xs"
          />
        </FormField>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pub,text/plain"
          className="hidden"
          onChange={(e) => {
            void loadKeys(e.target.files)
            e.target.value = ''
          }}
        />
      </FormSection>

      <FormRow>
        <FormField label="资源池" name="pool">
          <PoolSelect value={form.pool} onChange={(pool) => set({ pool })} />
        </FormField>
        <FormField label="标签" name="tags">
          <TagInput value={form.tags} onChange={(tags) => set({ tags })} />
        </FormField>
      </FormRow>
      {inCluster && (
        <SwitchField label="加入 HA" description="创建后作为高可用资源由集群管理" checked={form.haManaged} onCheckedChange={(haManaged) => set({ haManaged })} />
      )}
    </div>
  )
}

// -------------------------------------------------------------- template

export function LxcTemplateStep({ form, set }: LxcStepProps) {
  return (
    <div className="grid gap-5">
      <FormRow>
        <FormField label="存储" name="templateStorage" required>
          <StorageSelect
            node={form.node}
            content="vztmpl"
            value={form.templateStorage}
            onValueChange={(s) => set({ templateStorage: s ?? '', ostemplate: '' })}
          />
        </FormField>
        <FormField label="模板" name="ostemplate" required>
          <VolumeSelect
            node={form.node}
            storage={form.templateStorage}
            content="vztmpl"
            value={form.ostemplate}
            onChange={(ostemplate) => set({ ostemplate })}
            placeholder="选择模板或 OCI 镜像"
          />
        </FormField>
      </FormRow>
      <p className="text-xs leading-relaxed text-muted-foreground">
        列表包括系统模板（.tar.zst / .tar.xz）和从 OCI 仓库拉取的应用镜像。需要新模板时，到存储的“容器模板”页下载或拉取。
      </p>
    </div>
  )
}

// ----------------------------------------------------------------- disks

function useStorageType(node: string, storage: string) {
  const { data } = useNodeStorages(node || undefined, 'rootdir')
  return data?.find((s) => s.storage === storage)?.type
}

function MountPointCard({ form, mp, update }: LxcStepProps & { mp: LxcMountPoint }) {
  const id = `mp${mp.index}`
  const patch = (p: Partial<LxcMountPoint>) => update((f) => ({ ...f, mountPoints: f.mountPoints.map((m) => (m.key === mp.key ? { ...m, ...p } : m)) }))
  const type = useStorageType(form.node, mp.storage)
  const quotaOk = quotaAllowed(form.unprivileged, type)
  const indexes = freeMpIndexes(form, mp.key)
  return (
    <section aria-label={`挂载点 ${id}`} className="grid gap-4 rounded-xl border border-border bg-(--field) p-3.5 sm:p-4">
      <header className="flex items-center gap-2.5">
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand/12 text-brand-strong paper:bg-primary/10 paper:text-primary">
          <FolderInput className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-medium text-foreground">{id}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{mp.path || '未设置路径'}</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => update((f) => ({ ...f, mountPoints: f.mountPoints.filter((m) => m.key !== mp.key) }))}
          aria-label={`删除挂载点 ${id}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </header>
      <FormRow>
        <FormField label="挂载路径" name={id} required>
          <FieldInput value={mp.path} onChange={(e) => patch({ path: e.target.value.trim() })} placeholder="/mnt/data" className="font-mono" autoCapitalize="none" spellCheck={false} />
        </FormField>
        <FormField label="编号">
          <SelectField
            value={String(mp.index)}
            onValueChange={(v) => v !== undefined && patch({ index: Number(v) })}
            options={[mp.index, ...indexes.filter((i) => i !== mp.index)].sort((a, b) => a - b).map((i) => ({ value: String(i), label: `mp${i}` }))}
          />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="存储" required>
          <StorageSelect node={form.node} content="rootdir" value={mp.storage} onValueChange={(storage) => patch({ storage: storage ?? '' })} />
        </FormField>
        <FormField label="大小" required>
          <SizeInput value={mp.size} onChange={(size) => patch({ size })} baseUnit="GiB" units={['GiB', 'TiB']} min={1} />
        </FormField>
      </FormRow>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <SwitchField label="加入备份" checked={mp.backup} onCheckedChange={(backup) => patch({ backup })} />
        <SwitchField label="只读" checked={mp.readonly} onCheckedChange={(readonly) => patch({ readonly })} />
      </div>
      <FormSection collapsible title="高级选项">
        <FormRow>
          <FormField label="ACL">
            <SelectField value={mp.acl} onValueChange={(v) => patch({ acl: (v ?? '') as AclMode })} options={ACL_OPTIONS} emptyOption="默认" />
          </FormField>
          <div className="grid content-end">
            <SwitchField
              label="启用配额"
              description={quotaOk ? undefined : '仅特权容器且非 ZFS 存储'}
              checked={mp.quota && quotaOk}
              disabled={!quotaOk}
              onCheckedChange={(quota) => patch({ quota })}
            />
          </div>
        </FormRow>
        <FormField label="挂载选项">
          <ChipToggles aria-label="挂载选项" options={MOUNT_OPTIONS} value={mp.mountoptions} onChange={(mountoptions) => patch({ mountoptions })} />
        </FormField>
        <SwitchField label="跳过复制" checked={mp.noReplicate} onCheckedChange={(noReplicate) => patch({ noReplicate })} />
      </FormSection>
    </section>
  )
}

export function LxcDisksStep(props: LxcStepProps) {
  const { form, set, update } = props
  const type = useStorageType(form.node, form.rootStorage)
  const quotaOk = quotaAllowed(form.unprivileged, type)
  return (
    <div className="grid gap-4">
      <section aria-label="根磁盘" className="grid gap-4 rounded-xl border border-border bg-(--field) p-3.5 sm:p-4">
        <header className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand/12 text-brand-strong paper:bg-primary/10 paper:text-primary">
            <HardDrive className="size-4" aria-hidden />
          </span>
          <div>
            <div className="font-mono text-sm font-medium text-foreground">rootfs</div>
            <div className="text-xs text-muted-foreground">根磁盘，挂载到 /</div>
          </div>
        </header>
        <FormRow>
          <FormField label="存储" name="rootfs" required>
            <StorageSelect node={form.node} content="rootdir" value={form.rootStorage} onValueChange={(s) => set({ rootStorage: s ?? '' })} />
          </FormField>
          <FormField label="大小" required>
            <SizeInput value={form.rootSize} onChange={(rootSize) => set({ rootSize })} baseUnit="GiB" units={['GiB', 'TiB']} min={1} />
          </FormField>
        </FormRow>
        <FormSection collapsible title="高级选项">
          <FormRow>
            <FormField label="ACL">
              <SelectField value={form.rootAcl} onValueChange={(v) => set({ rootAcl: (v ?? '') as AclMode })} options={ACL_OPTIONS} emptyOption="默认" />
            </FormField>
            <div className="grid content-end">
              <SwitchField
                label="启用配额"
                description={quotaOk ? undefined : '仅特权容器且非 ZFS 存储'}
                checked={form.rootQuota && quotaOk}
                disabled={!quotaOk}
                onCheckedChange={(rootQuota) => set({ rootQuota })}
              />
            </div>
          </FormRow>
          <FormField label="挂载选项">
            <ChipToggles aria-label="根磁盘挂载选项" options={ROOTFS_MOUNT_OPTIONS} value={form.rootMountOptions} onChange={(rootMountOptions) => set({ rootMountOptions })} />
          </FormField>
          <SwitchField label="跳过复制" checked={form.rootNoReplicate} onCheckedChange={(rootNoReplicate) => set({ rootNoReplicate })} />
        </FormSection>
      </section>

      {form.mountPoints.map((mp) => (
        <MountPointCard key={mp.key} {...props} mp={mp} />
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => update((f) => ({ ...f, mountPoints: [...f.mountPoints, newMountPoint(f, f.rootStorage)] }))}
        className="h-11 border-dashed"
      >
        <Plus /> 添加挂载点
      </Button>
    </div>
  )
}

// ------------------------------------------------------------ cpu, memory

export function LxcCpuStep({ form, set }: LxcStepProps) {
  const node = useNodeInfo(form.node)
  return (
    <div className="grid gap-6">
      <FormField
        label="核心"
        name="cores"
        hint={node?.maxcpu !== undefined ? `节点有 ${node.maxcpu} 个 CPU。留空表示不限制。` : '留空表示不限制。'}
      >
        <NumberInput value={form.cores} onChange={(cores) => set({ cores })} min={1} max={8192} stepper placeholder="不限" />
      </FormField>
      <FormSection collapsible title="高级选项">
        <FormRow>
          <OptionalNumber label="CPU 限制" name="cpulimit" value={form.cpulimit} onChange={(cpulimit) => set({ cpulimit })} placeholder="不限制" unit="核" min={0} decimal />
          <OptionalNumber label="CPU 权重" name="cpuunits" value={form.cpuunits} onChange={(cpuunits) => set({ cpuunits })} placeholder="100" min={8} max={10000} hint="越大分到的 CPU 时间越多" />
        </FormRow>
      </FormSection>
    </div>
  )
}

export function LxcMemoryStep({ form, set }: LxcStepProps) {
  const node = useNodeInfo(form.node)
  const nodeMemMiB = node?.maxmem ? Math.floor(node.maxmem / 1024 ** 2) : undefined
  return (
    <div className="grid gap-6">
      <FormField
        label="内存"
        name="memory"
        required
        hint={node?.maxmem ? `节点内存 ${formatBytes(node.maxmem)}，已用 ${formatBytes(node.mem ?? 0)}` : undefined}
      >
        <SizeInput value={form.memory} onChange={(memory) => set({ memory })} baseUnit="MiB" units={['MiB', 'GiB']} min={16} />
      </FormField>
      <MemoryPresets value={form.memory} onPick={(memory) => set({ memory })} max={nodeMemMiB} />
      <FormField label="交换分区" name="swap" required hint="0 表示不使用交换">
        <SizeInput value={form.swap} onChange={(swap) => set({ swap })} baseUnit="MiB" units={['MiB', 'GiB']} min={0} />
      </FormField>
    </div>
  )
}

// --------------------------------------------------------------- network

export function LxcNetworkStep({ form, set }: LxcStepProps) {
  return (
    <div className="grid gap-6">
      <FormRow>
        <FormField label="网卡名称" name="netName" required>
          <FieldInput value={form.netName} onChange={(e) => set({ netName: e.target.value })} className="font-mono" autoCapitalize="none" spellCheck={false} />
        </FormField>
        <FormField label="网桥" name="bridge" required>
          <BridgeSelect node={form.node} value={form.bridge} onValueChange={(bridge) => set({ bridge: bridge ?? '' })} />
        </FormField>
      </FormRow>
      <FormRow>
        <OptionalNumber label="VLAN 标签" name="tag" value={form.vlan} onChange={(vlan) => set({ vlan })} placeholder="无" min={1} max={4094} />
        <FormField label="MAC 地址" name="hwaddr">
          <FieldInput value={form.hwaddr} onChange={(e) => set({ hwaddr: e.target.value.trim() })} placeholder="自动生成" autoCapitalize="characters" spellCheck={false} className="font-mono" />
        </FormField>
      </FormRow>
      <SwitchField label="防火墙" description="在这个网卡上启用 PVE 防火墙" checked={form.firewall} onCheckedChange={(firewall) => set({ firewall })} />

      <FormSection title="IPv4">
        <ChoiceCards<Ipv4Mode>
          aria-label="IPv4"
          size="sm"
          value={form.ipv4Mode}
          onChange={(ipv4Mode) => set({ ipv4Mode })}
          options={[
            { value: 'dhcp', label: 'DHCP', icon: <Wifi /> },
            { value: 'static', label: '静态', icon: <Globe /> },
            { value: 'none', label: '不配置', icon: <WifiOff /> },
          ]}
        />
        {form.ipv4Mode === 'static' && (
          <FormRow>
            <FormField label="IPv4/CIDR" name="ip" required>
              <FieldInput value={form.ip} onChange={(e) => set({ ip: e.target.value })} placeholder="192.168.1.20/24" inputMode="decimal" className="font-mono" spellCheck={false} />
            </FormField>
            <FormField label="网关" name="gw">
              <FieldInput value={form.gw} onChange={(e) => set({ gw: e.target.value })} placeholder="192.168.1.1" inputMode="decimal" className="font-mono" spellCheck={false} />
            </FormField>
          </FormRow>
        )}
      </FormSection>

      <FormSection title="IPv6">
        <ChoiceCards<Ipv6Mode>
          aria-label="IPv6"
          size="sm"
          columns={4}
          value={form.ipv6Mode}
          onChange={(ipv6Mode) => set({ ipv6Mode })}
          options={[
            { value: 'none', label: '不配置' },
            { value: 'dhcp', label: 'DHCP' },
            { value: 'auto', label: 'SLAAC' },
            { value: 'static', label: '静态' },
          ]}
        />
        {form.ipv6Mode === 'static' && (
          <FormRow>
            <FormField label="IPv6/CIDR" name="ip6" required>
              <FieldInput value={form.ip6} onChange={(e) => set({ ip6: e.target.value })} placeholder="2001:db8::20/64" className="font-mono" autoCapitalize="none" spellCheck={false} />
            </FormField>
            <FormField label="网关" name="gw6">
              <FieldInput value={form.gw6} onChange={(e) => set({ gw6: e.target.value })} placeholder="2001:db8::1" className="font-mono" autoCapitalize="none" spellCheck={false} />
            </FormField>
          </FormRow>
        )}
      </FormSection>

      <FormSection collapsible title="高级选项">
        <SwitchField label="断开连接" description="网卡存在但不接入网络" checked={form.disconnect} onCheckedChange={(disconnect) => set({ disconnect })} />
        <FormRow>
          <OptionalNumber label="MTU" name="mtu" value={form.mtu} onChange={(mtu) => set({ mtu })} placeholder="与网桥相同" min={576} max={65535} />
          <OptionalNumber label="限速" name="rate" value={form.rate} onChange={(rate) => set({ rate })} placeholder="不限" unit="MB/s" min={0} max={10240} decimal />
        </FormRow>
      </FormSection>
    </div>
  )
}

// ------------------------------------------------------------------- DNS

export function LxcDnsStep({ form, set }: LxcStepProps) {
  return (
    <div className="grid gap-5">
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-(--field) px-3.5 py-3 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-strong paper:text-primary" aria-hidden />
        留空时容器使用主机的 DNS 设置，大多数情况下不需要修改。
      </div>
      <FormField label="DNS 域" name="searchdomain">
        <FieldInput value={form.searchdomain} onChange={(e) => set({ searchdomain: e.target.value })} placeholder="使用主机设置" autoCapitalize="none" spellCheck={false} />
      </FormField>
      <FormField label="DNS 服务器" name="nameserver" hint="多个地址用空格分隔，支持 IPv4 和 IPv6">
        <FieldInput value={form.nameserver} onChange={(e) => set({ nameserver: e.target.value })} placeholder="使用主机设置" className="font-mono" autoCapitalize="none" spellCheck={false} />
      </FormField>
    </div>
  )
}
