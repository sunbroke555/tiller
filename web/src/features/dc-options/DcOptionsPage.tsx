import { useState, type ReactNode } from 'react'
import { Link, Route, Routes, useParams } from 'react-router'
import {
  ArrowLeftRight,
  AtSign,
  BellOff,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
  Gauge,
  Globe,
  Hash,
  HeartPulse,
  Keyboard,
  KeyRound,
  Languages,
  Layers,
  Lock,
  MapPin,
  Monitor,
  NotebookPen,
  Palette,
  Power,
  Repeat,
  ScrollText,
  Server,
  ShieldAlert,
  Tags,
  UserCog,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { useDcOptions } from '@/api/dc-options'
import { usePermissions } from '@/api/permissions'
import { useClusterStatus, useNodes } from '@/api/queries'
import { SUBSCRIPTION_LABEL, subscriptionLevel } from '@/features/datacenter/summary'
import { NotFoundPage } from '@/features/NotFoundPage'
import { ErrorCard } from '@/components/QueryState'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import {
  BwlimitDialog,
  ConsentTextDialog,
  CrsDialog,
  DescriptionDialog,
  LocationDialog,
  MaxWorkersDialog,
  NetworkSettingDialog,
  NextIdDialog,
  SelectOptionDialog,
  TextOptionDialog,
  U2fDialog,
  WebauthnDialog,
  saveOptions,
  type OptionDialogProps,
} from './dialogs'
import {
  CONSOLE_VIEWERS,
  FENCING_MODES,
  HA_SHUTDOWN_POLICIES,
  KEYBOARD_LAYOUTS,
  LANGUAGES,
  describeOption,
  haValue,
  parseHaPolicy,
  validateEmail,
  validateHttpProxy,
  validateMacPrefix,
  type OptionKey,
} from './model'
import { NodeSubscriptionPanel, SupportCard } from './SubscriptionPanel'
import { RegisteredTagsDialog, TagStyleDialog, UserTagAccessDialog } from './tagDialogs'
import { IconTile, OptionRow, Section } from './ui'

/** Datacenter section "数据中心选项" (/datacenter/options/*): options, subscriptions, support. */
export default function DcOptionsPage() {
  return (
    <Routes>
      <Route index element={<OptionsView />} />
      <Route path="subscription/:node" element={<SubscriptionView />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

interface RowDef {
  key: OptionKey
  label: string
  icon: LucideIcon
  /** Shown (muted) when the option is not set. */
  defaultText: string
  hint?: string
}

const SECTIONS: { id: string; title: string; rows: RowDef[] }[][] = [
  [
    {
      id: 'general',
      title: '常规',
      rows: [
        { key: 'keyboard', label: '键盘布局', icon: Keyboard, defaultText: '默认（由浏览器决定）', hint: 'noVNC 控制台的默认键盘布局' },
        { key: 'console', label: '控制台查看器', icon: Monitor, defaultText: '默认（xterm.js，不可用时 noVNC）' },
        { key: 'language', label: '界面语言', icon: Languages, defaultText: '默认（英语）', hint: '官方界面的默认语言' },
        { key: 'http_proxy', label: 'HTTP 代理', icon: Globe, defaultText: '无', hint: '下载软件包、模板和 ISO 时使用' },
        { key: 'email_from', label: '发件人地址', icon: AtSign, defaultText: '默认（root@<主机名>）' },
        { key: 'mac_prefix', label: 'MAC 地址前缀', icon: Fingerprint, defaultText: 'BC:24:11（默认）' },
        { key: 'consent-text', label: '登录同意书', icon: ScrollText, defaultText: '无' },
        { key: 'description', label: '数据中心备注', icon: NotebookPen, defaultText: '无' },
      ],
    },
    {
      id: 'migration',
      title: '迁移与资源',
      rows: [
        { key: 'migration', label: '迁移设置', icon: ArrowLeftRight, defaultText: '默认（secure，集群网络）' },
        { key: 'replication', label: '复制设置', icon: Repeat, defaultText: '默认（secure，集群网络）' },
        { key: 'bwlimit', label: '带宽限制', icon: Gauge, defaultText: '不限制' },
        { key: 'max_workers', label: '批量操作最大并发', icon: Layers, defaultText: '默认（4）' },
        { key: 'next-id', label: 'VMID 自动分配范围', icon: Hash, defaultText: '默认（100 起）' },
      ],
    },
    {
      id: 'ha',
      title: '高可用',
      rows: [
        { key: 'ha', label: 'HA 关机策略', icon: Power, defaultText: '默认（conditional）' },
        { key: 'crs', label: '集群资源调度', icon: HeartPulse, defaultText: '默认（basic）' },
        { key: 'fencing', label: '隔离模式', icon: ShieldAlert, defaultText: '默认（watchdog）' },
      ],
    },
  ],
  [
    {
      id: 'tags',
      title: '标签',
      rows: [
        { key: 'tag-style', label: '标签样式', icon: Palette, defaultText: '默认（圆点，按字母顺序，无颜色覆盖）' },
        { key: 'user-tag-access', label: '用户标签权限', icon: UserCog, defaultText: '默认（free：可设置任意标签）' },
        { key: 'registered-tags', label: '注册标签', icon: Tags, defaultText: '无' },
      ],
    },
    {
      id: 'tfa',
      title: '两步验证',
      rows: [
        { key: 'webauthn', label: 'WebAuthn', icon: KeyRound, defaultText: '未设置' },
        { key: 'u2f', label: 'U2F（已弃用）', icon: Lock, defaultText: '未设置' },
      ],
    },
    {
      id: 'other',
      title: '其他',
      rows: [
        { key: 'location', label: '位置', icon: MapPin, defaultText: '未设置' },
        { key: 'notify', label: '旧式通知设置', icon: BellOff, defaultText: '' },
      ],
    },
  ],
]

/** Node that answers for "localhost" (Support uses its subscription). */
function useLocalNode(): string | undefined {
  const status = useClusterStatus()
  const nodes = useNodes()
  const local = status.data?.find((e) => e.type === 'node' && e.local)
  return local?.name ?? nodes.data?.find((n) => n.status === 'online')?.node ?? nodes.data?.[0]?.node
}

function OptionsView() {
  const perms = usePermissions()
  const canEdit = perms.can({ privs: 'Sys.Modify', path: '/' })
  const query = useDcOptions()
  const options = query.data
  const [dialog, setDialog] = useState<OptionKey | null>(null)
  const localNode = useLocalNode()

  if (query.isError && !options) return <ErrorCard error={query.error} onRetry={() => void query.refetch()} title="无法读取数据中心选项" />

  const props = (key: OptionKey): OptionDialogProps => ({ open: dialog === key, onOpenChange: (o) => setDialog(o ? key : null), options })

  const row = (def: RowDef) => {
    const text = options ? describeOption(def.key, options) : undefined
    const isDefault = text === undefined
    if (def.key === 'notify' && isDefault) return null
    const reset = async () => {
      try {
        await saveOptions(options, { [def.key]: undefined }, `${def.label}恢复默认`)
      } catch (e) {
        toast.error(`${def.label}：恢复默认失败`, { description: errorMessage(e) })
      }
    }
    return (
      <OptionRow
        key={def.key}
        id={def.key}
        icon={def.icon}
        label={def.label}
        value={text ?? def.defaultText}
        isDefault={isDefault}
        detail={def.key === 'notify' ? '已由“通知”取代，这里只能清除。' : def.hint}
        onEdit={canEdit && def.key !== 'notify' ? () => setDialog(def.key) : undefined}
        onReset={canEdit && !isDefault ? () => void reset() : undefined}
      />
    )
  }

  return (
    <div className="grid gap-(--section-gap)">
      {!canEdit && (
        <p role="note" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" aria-hidden />
          只读：修改数据中心选项需要 / 上的 Sys.Modify 权限。
        </p>
      )}
      <div className="grid gap-(--section-gap) lg:grid-cols-2 lg:items-start">
        {SECTIONS.map((column, i) => (
          <div key={i} className="grid min-w-0 gap-(--section-gap)">
            {column.map((section) => (
              <Section key={section.id} id={`dc-${section.id}`} title={section.title}>
                {options ? section.rows.map(row) : <RowsSkeleton rows={section.rows.length} />}
              </Section>
            ))}
            {i === 1 && <SubscriptionSection localNode={localNode} />}
          </div>
        ))}
      </div>

      <SelectOptionDialog
        {...props('keyboard')}
        optionKey="keyboard"
        title="键盘布局"
        description="noVNC 控制台默认使用的键盘布局。"
        defaultLabel="默认"
        choices={Object.entries(KEYBOARD_LAYOUTS).map(([value, label]) => ({ value, label: `${label}（${value}）` }))}
      />
      <SelectOptionDialog
        {...props('console')}
        optionKey="console"
        title="控制台查看器"
        description="打开客户机控制台时默认使用的查看器；所选查看器不可用时（例如虚拟机没有启用 SPICE）使用 noVNC。"
        defaultLabel="默认（xterm.js）"
        choices={Object.entries(CONSOLE_VIEWERS)
          .filter(([v]) => v !== 'applet' || options?.console === 'applet')
          .map(([value, label]) => ({ value, label }))}
      />
      <SelectOptionDialog
        {...props('language')}
        optionKey="language"
        title="界面语言"
        description="官方 Web 界面的默认语言（本界面始终是中文）。"
        defaultLabel="默认（English）"
        choices={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label, description: value }))}
      />
      <TextOptionDialog
        {...props('http_proxy')}
        optionKey="http_proxy"
        title="HTTP 代理"
        description="节点下载软件包、模板和 ISO 时使用的 HTTP 代理。"
        hint="例如 http://user:pass@proxy.lan:3128/；留空不使用代理。"
        placeholder="无"
        inputMode="url"
        validate={validateHttpProxy}
      />
      <TextOptionDialog
        {...props('email_from')}
        optionKey="email_from"
        title="发件人地址"
        description="发送通知邮件时使用的发件人。"
        hint="留空使用 root@<主机名>。"
        placeholder="root@$hostname"
        inputMode="email"
        validate={validateEmail}
      />
      <TextOptionDialog
        {...props('mac_prefix')}
        optionKey="mac_prefix"
        title="MAC 地址前缀"
        description="自动生成的客户机 MAC 地址前缀。默认 BC:24:11 是 Proxmox 的 OUI，可以在局域网内使用。"
        hint="1–3 个字节，例如 02:8f；只能是单播地址。留空恢复默认。"
        placeholder="BC:24:11"
        validate={validateMacPrefix}
        normalize={(v) => v.trim().toUpperCase()}
      />
      <ConsentTextDialog {...props('consent-text')} />
      <DescriptionDialog {...props('description')} />
      <NetworkSettingDialog {...props('migration')} optionKey="migration" node={localNode} />
      <NetworkSettingDialog {...props('replication')} optionKey="replication" node={localNode} />
      <BwlimitDialog {...props('bwlimit')} />
      <MaxWorkersDialog {...props('max_workers')} />
      <NextIdDialog {...props('next-id')} />
      <SelectOptionDialog
        {...props('ha')}
        optionKey="ha"
        title="HA 关机策略"
        description="节点关机或重启时如何处理其上的 HA 资源。"
        defaultLabel="默认（conditional）"
        choices={Object.entries(HA_SHUTDOWN_POLICIES).map(([value, p]) => ({ value, label: p.label, description: p.hint }))}
        read={(v: unknown) => parseHaPolicy(v)}
        write={haValue}
      />
      <CrsDialog {...props('crs')} />
      <SelectOptionDialog
        {...props('fencing')}
        optionKey="fencing"
        title="隔离模式"
        description="HA 集群的隔离方式。hardware 需要在 /etc/pve/ha/fence.cfg 中配置隔离设备。"
        defaultLabel="默认（watchdog）"
        choices={Object.entries(FENCING_MODES).map(([value, label]) => ({ value, label }))}
        warn={(v) => (v === 'hardware' || v === 'both' ? 'hardware 和 both 模式是实验性功能，仍在开发中。' : null)}
      />
      <WebauthnDialog {...props('webauthn')} />
      <U2fDialog {...props('u2f')} />
      <TagStyleDialog {...props('tag-style')} />
      <UserTagAccessDialog {...props('user-tag-access')} />
      <RegisteredTagsDialog {...props('registered-tags')} />
      <LocationDialog {...props('location')} />
    </div>
  )
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-(--card-p) py-4">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------ subscriptions

function SubscriptionSection({ localNode }: { localNode: string | undefined }) {
  const status = useClusterStatus()
  const nodes = useNodes()
  const list = [...(nodes.data ?? [])].sort((a, b) => a.node.localeCompare(b.node, undefined, { numeric: true }))
  const levels = new Map(
    (status.data ?? []).flatMap((e) => (e.type === 'node' ? [[e.name, e.level] as const] : [])),
  )
  return (
    <>
      <Section id="dc-subscription" title="订阅">
        {nodes.isPending ? (
          <RowsSkeleton rows={1} />
        ) : (
          list.map((n) => {
            const level = subscriptionLevel(levels.get(n.node) ?? n.level)
            return (
              <Link
                key={n.node}
                to={`/datacenter/options/subscription/${encodeURIComponent(n.node)}`}
                data-node={n.node}
                className="flex min-h-16 items-center gap-3 px-(--card-p) py-(--row-py) transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] compact:min-h-12"
              >
                <IconTile icon={Server} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-medium">{n.node}</span>
                  <span className={cn('text-[13px] text-muted-foreground', level === 'none' && 'text-faint')}>
                    {level === 'none' ? '没有订阅' : `${SUBSCRIPTION_LABEL[level]} 订阅`}
                    {n.status !== 'online' && ' · 离线'}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
              </Link>
            )
          })
        )}
      </Section>
      <section aria-labelledby="dc-support-heading" className="min-w-0">
        <h2 id="dc-support-heading" className="mb-2.5 flex min-h-9 items-center text-sm font-medium text-muted-foreground paper:text-base paper:text-foreground">
          支持
        </h2>
        <SupportCard node={localNode} />
      </section>
    </>
  )
}

function SubscriptionView() {
  const { node = '' } = useParams()
  return (
    <div className="grid gap-3">
      <BackLink to="/datacenter/options">数据中心选项</BackLink>
      <h2 className="text-lg font-semibold">节点 {node}</h2>
      <NodeSubscriptionPanel node={node} />
    </div>
  )
}

function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="-ml-2 inline-flex min-h-11 w-fit items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <ChevronLeft className="size-4" />
      {children}
    </Link>
  )
}
