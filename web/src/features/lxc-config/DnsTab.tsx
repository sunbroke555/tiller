import { AtSign, Globe, Server } from 'lucide-react'

import { FieldInput, FormDialog, FormField } from '@/components/form'
import type { GuestTabProps } from '@/features/guest/types'

import { useDialog, useFormState, ValidationError } from './hooks'
import { isDnsName, normalizeNameservers, pendingOf, validateNameservers } from './model'
import { ConfigRow, ConfigSection, PendingBanner, TabBody, useLxcConfig, type LxcConfigApi } from './shared'

/** DNS tab of a container: host name, search domain, DNS servers. */
export default function DnsTab(props: GuestTabProps) {
  const api = useLxcConfig(props)
  return (
    <TabBody api={api}>
      <DnsBody api={api} />
    </TabBody>
  )
}

function DnsBody({ api }: { api: LxcConfigApi }) {
  const { cfg, config } = api
  const hostname = useDialog()
  const dns = useDialog()
  const revert = (key: string) => () => void api.revert([key]).catch(() => undefined)
  const servers = normalizeNameservers(cfg.nameserver).split(' ').filter(Boolean)
  return (
    <>
      <PendingBanner api={api} tab="dns" />
      <ConfigSection title="主机名">
        <ConfigRow
          icon={AtSign}
          label="主机名"
          value={cfg.hostname || `CT${api.vmid}`}
          muted={!cfg.hostname}
          detail="容器内的 hostname，也是容器在列表中显示的名称。"
          pending={pendingOf(config, 'hostname')}
          onEdit={() => hostname.show(true)}
          onRevert={revert('hostname')}
        />
      </ConfigSection>
      <ConfigSection title="DNS">
        <ConfigRow
          icon={Globe}
          label="DNS 域"
          value={cfg.searchdomain || '使用主机设置'}
          muted={!cfg.searchdomain}
          pending={pendingOf(config, 'searchdomain')}
          onEdit={() => dns.show(true)}
          onRevert={revert('searchdomain')}
        />
        <ConfigRow
          icon={Server}
          label="DNS 服务器"
          value={
            servers.length ? (
              <span className="flex flex-wrap gap-x-3 gap-y-0.5 tabular">
                {servers.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </span>
            ) : (
              '使用主机设置'
            )
          }
          muted={!servers.length}
          pending={pendingOf(config, 'nameserver')}
          onEdit={() => dns.show(true)}
          onRevert={revert('nameserver')}
        />
      </ConfigSection>
      <HostnameDialog {...hostname.props} api={api} />
      <DnsDialog {...dns.props} api={api} />
    </>
  )
}

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  api: LxcConfigApi
}

function HostnameDialog({ open, onOpenChange, api }: DialogProps) {
  const [value, setValue] = useFormState(open, () => api.cfg.hostname ?? '')
  const [attempted, setAttempted] = useFormState(open, () => false)
  const error = value.trim() && !isDnsName(value.trim()) ? '只能包含字母、数字和连字符，各段用点分隔' : undefined
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="主机名"
      description={api.running ? '新主机名会写入容器，重启后完全生效。' : undefined}
      onSubmit={async () => {
        setAttempted(true)
        if (error) throw new ValidationError()
        // Empty means the default name, which PVE needs spelled out.
        await api.save({ hostname: value.trim() || `CT${api.vmid}` }, '修改主机名')
      }}
    >
      <FormField label="主机名" name="hostname" error={attempted ? error : undefined} hint={`留空使用 CT${api.vmid}。`}>
        <FieldInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`CT${api.vmid}`}
          autoCapitalize="off"
          spellCheck={false}
        />
      </FormField>
    </FormDialog>
  )
}

function DnsDialog({ open, onOpenChange, api }: DialogProps) {
  const [form, setForm] = useFormState(open, () => ({
    searchdomain: api.cfg.searchdomain ?? '',
    nameserver: normalizeNameservers(api.cfg.nameserver),
  }))
  const [attempted, setAttempted] = useFormState(open, () => false)
  const nsError = validateNameservers(form.nameserver) ?? undefined
  const domainError =
    form.searchdomain.trim() && !form.searchdomain.trim().split(/\s+/).every(isDnsName) ? '不是有效的域名' : undefined
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="DNS"
      description="留空时容器使用主机的 DNS 设置。"
      onSubmit={async () => {
        setAttempted(true)
        if (nsError || domainError) throw new ValidationError()
        await api.save(
          { searchdomain: form.searchdomain.trim(), nameserver: normalizeNameservers(form.nameserver) },
          '修改 DNS 设置',
        )
      }}
    >
      <FormField label="DNS 域" name="searchdomain" error={attempted ? domainError : undefined}>
        <FieldInput
          value={form.searchdomain}
          onChange={(e) => setForm((f) => ({ ...f, searchdomain: e.target.value }))}
          placeholder="使用主机设置"
          autoCapitalize="off"
          spellCheck={false}
        />
      </FormField>
      <FormField
        label="DNS 服务器"
        name="nameserver"
        error={attempted ? nsError : undefined}
        hint="多个地址用空格或逗号分隔，支持 IPv4 和 IPv6。"
      >
        <FieldInput
          value={form.nameserver}
          onChange={(e) => setForm((f) => ({ ...f, nameserver: e.target.value }))}
          placeholder="使用主机设置"
          autoCapitalize="off"
          spellCheck={false}
          className="tabular"
        />
      </FormField>
    </FormDialog>
  )
}
