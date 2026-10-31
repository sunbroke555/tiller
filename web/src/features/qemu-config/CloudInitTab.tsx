import { useMemo, useState, type ReactNode } from 'react'
import { Cloud, FileCode, FileSearch, Globe, KeyRound, Layers, Lock, Network, PackageCheck, RefreshCw, Server, User } from 'lucide-react'
import { toast } from 'sonner'

import { regenerateCloudinit, useCloudinitPending, useQemuPending } from '@/api/qemu-config'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { fireTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { GuestTabProps } from '@/features/guest/types'
import { errorMessage } from '@/lib/errors'

import { isWindows } from './constants'
import {
  QemuConfigProvider,
  guestInvalidation,
  useDialogHost,
  useQemuConfig,
  useQemuConfigValue,
  useRevert,
  useSaveConfig,
  type DialogRenderProps,
} from './context'
import { CloudinitDriveDialog } from './editors/disks'
import { CiDnsDialog, CiDumpDialog, CiPasswordDialog, CiSshKeysDialog, CiTypeDialog, CiUserDialog, IpConfigDialog } from './editors/cloudinit'
import { DRIVE_RE, isCloudinitDrive, splitPending, type Config, type HwRowStatus } from './model'
import { decodeSshKeys, ipConfigFormFrom, parseCicustom, sshKeyLabels } from './params'
import { ConfigRow, ConfigSection, ConfigSkeleton, Hint, PendingBanner, type RowAction } from './ui'

/** /guest/:node/qemu/:vmid/cloudinit */
export default function CloudInitTab({ node, vmid, guest }: GuestTabProps) {
  const pending = useQemuPending(node, vmid)
  const state = useMemo(() => splitPending(pending.data), [pending.data])
  const ctx = useQemuConfigValue(node, vmid, guest, state)
  if (pending.isPending) return <ConfigSkeleton />
  if (pending.isError && !pending.data) {
    return (
      <GlassCard>
        <EmptyState
          icon={Cloud}
          title="无法加载 Cloud-Init 配置"
          description={pending.error.message}
          action={
            <Button variant="outline" onClick={() => void pending.refetch()}>
              重试
            </Button>
          }
        />
      </GlassCard>
    )
  }
  return (
    <QemuConfigProvider value={ctx}>
      <CloudInitView />
    </QemuConfigProvider>
  )
}

function ipSummary(value: string | undefined): string {
  if (!value) return '未配置'
  const f = ipConfigFormFrom(value)
  const v4 = f.ipv4 === 'dhcp' ? 'IPv4 DHCP' : f.ipv4 === 'static' ? `${f.ip}${f.gw ? ` 网关 ${f.gw}` : ''}` : null
  const v6 = f.ipv6 === 'dhcp' ? 'IPv6 DHCP' : f.ipv6 === 'auto' ? 'IPv6 SLAAC' : f.ipv6 === 'static' ? `${f.ip6}${f.gw6 ? ` 网关 ${f.gw6}` : ''}` : null
  return [v4, v6].filter(Boolean).join(' · ') || '未配置'
}

function sshSummary(value: string | undefined): string {
  const labels = sshKeyLabels(decodeSshKeys(value))
  return labels.length ? labels.join('、') : '无'
}

interface CiRow {
  id: string
  keys: string[]
  title: string
  icon: typeof User
  summary: (cfg: Config) => string
  edit?: (p: DialogRenderProps) => ReactNode
  mono?: boolean
}

function CloudInitView() {
  const { state, node, vmid, cfg, guest, running, can } = useQemuConfig()
  const { show, host } = useDialogHost()
  const revert = useRevert()
  const driveKey = Object.keys({ ...state.current, ...state.next }).find((k) => DRIVE_RE.test(k) && isCloudinitDrive(state.next[k] ?? state.current[k]))
  const ciPending = useCloudinitPending(node, vmid, !!driveKey && running)
  const regenNeeded = running && (ciPending.data ?? []).some((e) => e.pending !== undefined || e.delete)
  const allowed = can('VM.Config.Cloudinit') || can('VM.Config.Network')

  if (!driveKey) {
    return (
      <GlassCard>
        <EmptyState
          icon={Cloud}
          title="没有 Cloud-Init 驱动器"
          description="添加 Cloud-Init 驱动器后，可以给支持 cloud-init 的镜像设置用户、密码、SSH 公钥和网络。"
          action={
            can('VM.Config.CDROM') && can('VM.Config.Cloudinit') ? (
              <Button onClick={() => show((p) => <CloudinitDriveDialog {...p} />)}>
                <Cloud />
                添加 Cloud-Init 驱动器
              </Button>
            ) : undefined
          }
        />
        {host}
      </GlassCard>
    )
  }

  const userRows: CiRow[] = [
    { id: 'ciuser', keys: ['ciuser'], title: '用户', icon: User, summary: (c) => c.ciuser ?? '默认', edit: (p) => <CiUserDialog {...p} /> },
    { id: 'cipassword', keys: ['cipassword'], title: '密码', icon: Lock, summary: (c) => (c.cipassword ? '已设置' : '无'), edit: (p) => <CiPasswordDialog {...p} /> },
    { id: 'sshkeys', keys: ['sshkeys'], title: 'SSH 公钥', icon: KeyRound, summary: (c) => sshSummary(c.sshkeys), edit: (p) => <CiSshKeysDialog {...p} /> },
  ]
  const dnsRows: CiRow[] = [
    { id: 'searchdomain', keys: ['searchdomain'], title: 'DNS 域', icon: Globe, summary: (c) => c.searchdomain ?? '使用宿主机设置', edit: (p) => <CiDnsDialog {...p} /> },
    { id: 'nameserver', keys: ['nameserver'], title: 'DNS 服务器', icon: Server, summary: (c) => c.nameserver ?? '使用宿主机设置', edit: (p) => <CiDnsDialog {...p} />, mono: true },
  ]
  const netKeys = Object.keys({ ...state.current, ...state.next })
    .filter((k) => /^net\d+$/.test(k))
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
  const netRows: CiRow[] = netKeys.map((net) => {
    const ip = `ipconfig${net.slice(3)}`
    return {
      id: net,
      keys: [ip],
      title: `IP 配置 (${net})`,
      icon: Network,
      summary: (c) => ipSummary(c[ip]),
      edit: (p) => <IpConfigDialog {...p} net={net} />,
      mono: true,
    }
  })
  const advancedRows: CiRow[] = [
    {
      id: 'citype',
      keys: ['citype'],
      title: '类型',
      icon: Layers,
      summary: (c) => c.citype ?? `默认 (${isWindows(c.ostype) ? 'configdrive2' : 'nocloud'})`,
      edit: (p) => <CiTypeDialog {...p} />,
    },
    {
      id: 'cicustom',
      keys: ['cicustom'],
      title: '自定义配置 (cicustom)',
      icon: FileCode,
      summary: (c) => {
        const list = parseCicustom(c.cicustom)
        return list.length ? list.map(([k, v]) => `${k}: ${v}`).join(' · ') : '无'
      },
      mono: true,
    },
  ]

  const status = (keys: string[]): HwRowStatus => (keys.some((k) => state.pending.has(k)) ? 'changed' : 'unchanged')
  const pendingKeys = [...state.pending].filter((k) =>
    ['ciuser', 'cipassword', 'sshkeys', 'searchdomain', 'nameserver', 'citype', 'cicustom', 'ciupgrade'].includes(k) || /^ipconfig\d+$/.test(k),
  )

  const render = (row: CiRow) => {
    const st = status(row.keys)
    const summary = row.summary(state.current)
    const after = st !== 'unchanged' ? row.summary(state.next) : undefined
    const actions: RowAction[] = []
    if (st !== 'unchanged') {
      if (row.edit && allowed) actions.push({ id: 'edit', label: '编辑', onSelect: () => show(row.edit!) })
      actions.push({
        id: 'revert',
        label: '撤销未生效的更改',
        onSelect: () => void revert(row.keys, `撤销 ${row.title}`).catch((e: unknown) => toast.error(errorMessage(e))),
      })
    }
    return (
      <ConfigRow
        key={row.id}
        testId={`ci-${row.id}`}
        icon={row.icon}
        title={row.title}
        summary={summary}
        pendingSummary={after !== summary ? after : undefined}
        status={st}
        mono={row.mono}
        onOpen={row.edit && allowed ? () => show(row.edit!) : undefined}
        openLabel={`编辑${row.title}`}
        actions={actions}
      />
    )
  }

  const custom = parseCicustom(cfg.cicustom)

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-muted-foreground">
          驱动器 <span className="font-mono text-xs">{driveKey}</span> · 下次启动时自动应用
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => show((p) => <CiDumpDialog {...p} />)}>
            <FileSearch />
            查看生成的配置
          </Button>
          <Button
            variant="outline"
            disabled={!can('VM.Config.Cloudinit')}
            onClick={() =>
              fireTask(regenerateCloudinit(node, vmid), {
                title: '重新生成 Cloud-Init 镜像',
                invalidate: guestInvalidation(node, vmid),
                syncSuccessMessage: 'Cloud-Init 镜像已重新生成',
              })
            }
          >
            <RefreshCw />
            重新生成镜像
          </Button>
        </div>
      </div>
      {regenNeeded && (
        <Hint tone="warning">虚拟机运行中，部分设置还没有写入 Cloud-Init 镜像。点击“重新生成镜像”，客户机重启后会读取新配置。</Hint>
      )}
      <PendingBanner count={pendingKeys.length} running={running} />
      {guest.template === 1 && <Hint>这是模板：从它克隆的虚拟机会继承这些 Cloud-Init 设置。</Hint>}
      <ConfigSection title="用户">{userRows.map(render)}</ConfigSection>
      <ConfigSection title="DNS">{dnsRows.map(render)}</ConfigSection>
      {netRows.length > 0 && <ConfigSection title="网络">{netRows.map(render)}</ConfigSection>}
      <ConfigSection title="其他">
        <UpgradeRow />
        {advancedRows.map(render)}
      </ConfigSection>
      {custom.length > 0 && (
        <Hint>
          已配置自定义片段（cicustom），对应部分会使用片段文件的内容，而不是上面的设置。片段只能在命令行（qm set --cicustom）修改。
        </Hint>
      )}
      {host}
    </div>
  )
}

function UpgradeRow() {
  const { cfg, state, can } = useQemuConfig()
  const save = useSaveConfig()
  const [busy, setBusy] = useState(false)
  const checked = cfg.ciupgrade === undefined ? true : cfg.ciupgrade === '1'
  const pending = state.pending.has('ciupgrade')
  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      await save(on ? { delete: 'ciupgrade' } : { ciupgrade: '0' }, { title: on ? '启用开机升级软件包' : '关闭开机升级软件包' })
    } catch (e) {
      toast.error('修改失败', { description: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="flex min-h-16 items-center gap-3 px-(--card-p) py-(--row-py) compact:min-h-13">
      <span
        aria-hidden
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/75 paper:ring-border"
      >
        <PackageCheck className="size-[18px]" />
      </span>
      <label htmlFor="ci-upgrade" className="grid min-w-0 flex-1 cursor-pointer gap-0.5">
        <span className="font-medium">升级软件包</span>
        <span className="text-[13px] text-muted-foreground">{pending ? <span className="text-warning">已修改，待生效</span> : '首次启动时自动升级软件包'}</span>
      </label>
      <Switch id="ci-upgrade" checked={checked} disabled={busy || !can('VM.Config.Cloudinit')} onCheckedChange={(on) => void toggle(on)} aria-label="升级软件包" />
    </li>
  )
}

