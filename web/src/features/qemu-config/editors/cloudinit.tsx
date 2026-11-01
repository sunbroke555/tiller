// Editors of the Cloud-Init tab.

import { useRef, useState } from 'react'
import { Eye, EyeOff, FileUp } from 'lucide-react'

import { useCloudinitDump, type CloudinitDumpType } from '@/api/qemu-config'
import { FieldInput, FieldTextarea, FormDialog, FormField, FormRow, SelectField } from '@/components/form'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import { isWindows } from '../constants'
import { useQemuConfig, useSaveConfig, type DialogRenderProps } from '../context'
import {
  decodeSshKeys,
  encodeSshKeys,
  ipConfigFormFrom,
  ipConfigValue,
  sshKeyLabels,
  updateParams,
  type IpConfigForm,
} from '../params'
import { Hint, Segmented } from '../ui'

export function CiUserDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [user, setUser] = useState(cfg.ciuser ?? '')
  const invalid = /\s/.test(user.trim())
  const params = updateParams(cfg, { ciuser: user.trim() }, digest)
  return (
    <FormDialog {...props} size="sm" title="用户" submitDisabled={!params || invalid} onSubmit={() => save(params, { title: '修改 Cloud-Init 用户' })}>
      <FormField label="用户名" name="ciuser" hint="留空使用镜像的默认用户（如 debian、ubuntu）" error={invalid ? '用户名不能包含空格' : undefined}>
        <FieldInput value={user} onChange={(e) => setUser(e.target.value)} placeholder="默认" autoCapitalize="off" spellCheck={false} autoFocus />
      </FormField>
    </FormDialog>
  )
}

export function CiPasswordDialog(props: DialogRenderProps) {
  const { cfg } = useQemuConfig()
  const save = useSaveConfig()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const mismatch = confirm !== '' && password !== confirm
  const hasPassword = !!cfg.cipassword
  return (
    <FormDialog
      {...props}
      size="sm"
      title="密码"
      description="密码以哈希形式保存，设置后不会再显示。更推荐使用 SSH 公钥登录。"
      submitDisabled={!password || password !== confirm}
      onSubmit={() => save({ cipassword: password }, { title: '设置 Cloud-Init 密码' })}
      footerExtra={
        hasPassword ? (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => void save({ delete: 'cipassword' }, { title: '清除 Cloud-Init 密码' }).then(() => props.onOpenChange(false))}>
            清除密码
          </Button>
        ) : undefined
      }
    >
      <FormField label="新密码" name="cipassword">
        <div className="relative">
          <FieldInput
            type={visible ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="pr-11"
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute inset-y-0 right-0 my-auto text-muted-foreground"
            aria-label={visible ? '隐藏密码' : '显示密码'}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </FormField>
      <FormField label="确认密码" error={mismatch ? '两次输入的密码不一致' : undefined}>
        <FieldInput type={visible ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </FormField>
      {hasPassword && (
        <Button
          type="button"
          variant="outline"
          className="text-destructive sm:hidden"
          onClick={() => void save({ delete: 'cipassword' }, { title: '清除 Cloud-Init 密码' }).then(() => props.onOpenChange(false))}
        >
          清除已设置的密码
        </Button>
      )}
    </FormDialog>
  )
}

export function CiDnsDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [domain, setDomain] = useState(cfg.searchdomain ?? '')
  const [servers, setServers] = useState(cfg.nameserver ?? '')
  const params = updateParams(cfg, { searchdomain: domain.trim(), nameserver: servers.trim().replace(/[,\s]+/g, ' ') }, digest)
  return (
    <FormDialog {...props} title="DNS" description="留空则使用宿主机的设置。" submitDisabled={!params} onSubmit={() => save(params, { title: '修改 Cloud-Init DNS' })}>
      <FormField label="DNS 域" name="searchdomain">
        <FieldInput value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="使用宿主机设置" autoCapitalize="off" spellCheck={false} />
      </FormField>
      <FormField label="DNS 服务器" name="nameserver" hint="多个地址用空格分隔，支持 IPv4 和 IPv6">
        <FieldInput value={servers} onChange={(e) => setServers(e.target.value)} placeholder="使用宿主机设置" className="font-mono" inputMode="url" spellCheck={false} />
      </FormField>
    </FormDialog>
  )
}

export function CiSshKeysDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [keys, setKeys] = useState(() => decodeSshKeys(cfg.sshkeys).trim())
  const file = useRef<HTMLInputElement>(null)
  const labels = sshKeyLabels(keys)
  const encoded = encodeSshKeys(keys)
  // Compare decoded so a different encoding of the same keys is no change.
  const unchanged = decodeSshKeys(cfg.sshkeys).trim() === keys.trim()
  const params = unchanged ? null : updateParams(cfg, { sshkeys: encoded }, digest)
  const load = async (files: FileList | null) => {
    if (!files) return
    const texts = await Promise.all([...files].map((f) => f.text()))
    setKeys((k) => [k.trim(), ...texts.map((t) => t.trim())].filter(Boolean).join('\n'))
  }
  return (
    <FormDialog {...props} size="lg" title="SSH 公钥" description="每行一个公钥（authorized_keys 格式）。" submitDisabled={!params} onSubmit={() => save(params, { title: '修改 SSH 公钥' })}>
      <FormField label="公钥" name="sshkeys" hint={labels.length ? `${labels.length} 个公钥：${labels.join('、')}` : undefined}>
        <FieldTextarea
          value={keys}
          onChange={(e) => setKeys(e.target.value)}
          className="min-h-40 font-mono text-xs break-all"
          placeholder="ssh-ed25519 AAAA… user@host"
          spellCheck={false}
        />
      </FormField>
      <input ref={file} type="file" multiple accept=".pub,text/plain" className="hidden" onChange={(e) => void load(e.target.files).then(() => (e.target.value = ''))} />
      <Button type="button" variant="outline" onClick={() => file.current?.click()}>
        <FileUp />
        从文件加载公钥
      </Button>
    </FormDialog>
  )
}

export function CiTypeDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [type, setType] = useState<string | undefined>(cfg.citype)
  const params = updateParams(cfg, { citype: type ?? '' }, digest)
  return (
    <FormDialog {...props} size="sm" title="Cloud-Init 类型" submitDisabled={!params} onSubmit={() => save(params, { title: '修改 Cloud-Init 类型' })}>
      <FormField label="格式" name="citype" hint="Windows（cloudbase-init）用 configdrive2，其余一般用 nocloud。">
        <SelectField
          value={type}
          onValueChange={setType}
          emptyOption={`默认 (${isWindows(cfg.ostype) ? 'configdrive2' : 'nocloud'})`}
          options={['nocloud', 'configdrive2', 'opennebula'].map((v) => ({ value: v, label: v }))}
        />
      </FormField>
    </FormDialog>
  )
}

export function IpConfigDialog({ net, ...props }: DialogRenderProps & { net: string }) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const key = `ipconfig${net.replace('net', '')}`
  const [f, setF] = useState<IpConfigForm>(() => ipConfigFormFrom(cfg[key]))
  const set = (patch: Partial<IpConfigForm>) => setF((v) => ({ ...v, ...patch }))
  const v4Invalid = f.ipv4 === 'static' && !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(f.ip.trim())
  const gwInvalid = f.ipv4 === 'static' && f.gw.trim() !== '' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(f.gw.trim())
  const v6Invalid = f.ipv6 === 'static' && !/^[0-9a-f:]+\/\d{1,3}$/i.test(f.ip6.trim())
  const params = updateParams(cfg, { [key]: ipConfigValue(f) }, digest)
  return (
    <FormDialog
      {...props}
      title={`IP 配置 (${net})`}
      submitDisabled={!params || v4Invalid || gwInvalid || v6Invalid}
      onSubmit={() => save(params, { title: `修改 ${net} 的 IP 配置` })}
    >
      <FormField label="IPv4">
        <Segmented
          aria-label="IPv4 模式"
          value={f.ipv4}
          onValueChange={(ipv4) => set({ ipv4 })}
          options={[
            { value: 'none', label: '不配置' },
            { value: 'dhcp', label: 'DHCP' },
            { value: 'static', label: '静态' },
          ]}
        />
      </FormField>
      {f.ipv4 === 'static' && (
        <FormRow>
          <FormField label="IPv4/CIDR" name={key} required error={v4Invalid && f.ip ? '格式：192.168.1.10/24' : undefined}>
            <FieldInput value={f.ip} onChange={(e) => set({ ip: e.target.value })} placeholder="192.168.1.10/24" className="font-mono" inputMode="decimal" />
          </FormField>
          <FormField label="网关" error={gwInvalid ? '格式：192.168.1.1' : undefined}>
            <FieldInput value={f.gw} onChange={(e) => set({ gw: e.target.value })} placeholder="192.168.1.1" className="font-mono" inputMode="decimal" />
          </FormField>
        </FormRow>
      )}
      <FormField label="IPv6">
        <Segmented
          aria-label="IPv6 模式"
          value={f.ipv6}
          onValueChange={(ipv6) => set({ ipv6 })}
          options={[
            { value: 'none', label: '不配置' },
            { value: 'dhcp', label: 'DHCP' },
            { value: 'auto', label: 'SLAAC' },
            { value: 'static', label: '静态' },
          ]}
        />
      </FormField>
      {f.ipv6 === 'static' && (
        <FormRow>
          <FormField label="IPv6/CIDR" required error={v6Invalid && f.ip6 ? '格式：2001:db8::10/64' : undefined}>
            <FieldInput value={f.ip6} onChange={(e) => set({ ip6: e.target.value })} placeholder="2001:db8::10/64" className="font-mono" />
          </FormField>
          <FormField label="网关">
            <FieldInput value={f.gw6} onChange={(e) => set({ gw6: e.target.value })} placeholder="2001:db8::1" className="font-mono" />
          </FormField>
        </FormRow>
      )}
      {f.ipv4 === 'none' && f.ipv6 === 'none' && <Hint>不配置时，nocloud 镜像默认对这块网卡使用 DHCP。</Hint>}
    </FormDialog>
  )
}

const DUMP_LABEL: Record<CloudinitDumpType, string> = { user: '用户数据', network: '网络配置', meta: '元数据' }

export function CiDumpDialog(props: DialogRenderProps) {
  const { node, vmid } = useQemuConfig()
  const [type, setType] = useState<CloudinitDumpType>('user')
  const dump = useCloudinitDump(node, vmid, type, props.open)
  return (
    <ResponsiveDialog {...props} size="lg" title="生成的 Cloud-Init 配置" description="根据当前设置生成的内容（只读）。">
      <div className="grid gap-3 pb-2">
        <Segmented
          aria-label="配置类型"
          value={type}
          onValueChange={setType}
          options={(['user', 'network', 'meta'] as const).map((t) => ({ value: t, label: DUMP_LABEL[t] }))}
        />
        {dump.isPending ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : dump.isError ? (
          <Hint tone="warning">{dump.error.message}</Hint>
        ) : (
          <pre className="max-h-[55dvh] overflow-auto rounded-xl border border-border/70 bg-(--field) p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
            {dump.data || '（空）'}
          </pre>
        )}
      </div>
    </ResponsiveDialog>
  )
}
