// Node subscription (official Node → Subscription): status, upload key,
// check now, remove, system report; and the datacenter Support card.

import { useState } from 'react'
import {
  BadgeCheck,
  CalendarClock,
  CircleHelp,
  Cpu,
  ExternalLink,
  FileText,
  Fingerprint,
  KeyRound,
  LifeBuoy,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'

import { SUBSCRIPTION_LEVEL_LABEL, SUBSCRIPTION_STATUS_LABEL } from '@/api/node-summary'
import {
  checkSubscription,
  removeSubscription,
  subscriptionInvalidations,
  uploadSubscriptionKey,
  useSubscription,
  type NodeSubscription,
} from '@/api/dc-options'
import { usePermissions } from '@/api/permissions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FieldInput, FormDialog, FormField } from '@/components/form'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SystemReportDialog } from '@/features/node-summary/SystemReportDialog'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { IconTile, Section, ValidationError, useFormState } from './ui'

export const SUBSCRIPTION_KEY_RE = /^pve[1248][cbsp]-[0-9a-f]{10}$/i

export function subscriptionActive(sub: NodeSubscription | undefined): boolean {
  return sub?.status?.toLowerCase() === 'active'
}

export function statusLabel(sub: NodeSubscription): string {
  return SUBSCRIPTION_STATUS_LABEL[sub.status?.toLowerCase()] ?? sub.status
}

export function StatusBadge({ sub }: { sub: NodeSubscription | undefined }) {
  if (!sub) return null
  const active = subscriptionActive(sub)
  const bad = ['invalid', 'expired', 'suspended'].includes(sub.status?.toLowerCase())
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium',
        active ? 'bg-success/12 text-success-strong' : bad ? 'bg-destructive/12 text-destructive' : 'bg-foreground/[0.06] text-muted-foreground',
      )}
    >
      {statusLabel(sub)}
      {active && sub.level && SUBSCRIPTION_LEVEL_LABEL[sub.level] ? ` · ${SUBSCRIPTION_LEVEL_LABEL[sub.level]}` : ''}
    </span>
  )
}

function DetailRow({ icon, label, children }: { icon: typeof KeyRound; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-start gap-3 px-(--card-p) py-(--row-py) sm:items-center compact:min-h-11">
      <IconTile icon={icon} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="min-w-0 text-sm break-all">{children}</span>
      </span>
    </div>
  )
}

/** Subscription of one node with its actions. */
export function NodeSubscriptionPanel({ node }: { node: string }) {
  const perms = usePermissions()
  const canModify = perms.can({ privs: 'Sys.Modify' }, { kind: 'node', node })
  const canAudit = perms.can({ privs: 'Sys.Audit' }, { kind: 'node', node })
  const sub = useSubscription(node)
  const [dialog, setDialog] = useState<'upload' | 'remove' | 'report' | null>(null)
  const [checking, setChecking] = useState(false)
  const dialogProps = (id: typeof dialog) => ({ open: dialog === id, onOpenChange: (o: boolean) => setDialog(o ? id : null) })
  const data = sub.data
  const hasKey = !!data?.key

  async function check() {
    setChecking(true)
    try {
      await runTask(checkSubscription(node), {
        title: `检查 ${node} 的订阅`,
        invalidate: subscriptionInvalidations(node),
        syncSuccessMessage: '订阅状态已更新',
      })
    } catch (e) {
      toast.error('检查订阅失败', { description: errorMessage(e) })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="grid gap-(--section-gap)">
      <Section
        id={`subscription-${node}`}
        title={
          <span className="flex items-center gap-2">
            订阅 <StatusBadge sub={data} />
          </span>
        }
      >
        {sub.isPending ? (
          <div aria-busy="true" aria-label="加载中" className="grid gap-3 p-(--card-p)">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        ) : sub.isError ? (
          <ErrorState compact title="无法读取订阅状态" error={sub.error} onRetry={() => void sub.refetch()} className="p-(--card-p)" />
        ) : data ? (
          <>
            <DetailRow icon={BadgeCheck} label="状态">
              {statusLabel(data)}
              {data.message && <span className="text-muted-foreground">：{data.message}</span>}
            </DetailRow>
            {data.productname && (
              <DetailRow icon={ShieldCheck} label="类型">
                {data.productname}
              </DetailRow>
            )}
            {data.key && (
              <DetailRow icon={KeyRound} label="订阅密钥">
                <span className="font-mono">{data.key}</span>
              </DetailRow>
            )}
            {data.serverid && (
              <DetailRow icon={Fingerprint} label="服务器 ID">
                <span className="font-mono">{data.serverid}</span>
              </DetailRow>
            )}
            {data.sockets !== undefined && (
              <DetailRow icon={Cpu} label="CPU 插槽数">
                {data.sockets}
              </DetailRow>
            )}
            {(data.checktime || data.nextduedate) && (
              <DetailRow icon={CalendarClock} label="上次检查 · 下次到期">
                <span className="tabular">
                  {data.checktime ? formatDateTime(data.checktime) : '—'} · {data.nextduedate || '—'}
                </span>
              </DetailRow>
            )}
            {!hasKey && (
              <p className="px-(--card-p) py-3 text-xs leading-relaxed text-muted-foreground">
                没有订阅密钥。可以继续使用 no-subscription 软件源；企业源和官方技术支持需要订阅。
              </p>
            )}
          </>
        ) : null}
      </Section>

      <div role="toolbar" aria-label="订阅操作" className="flex flex-wrap gap-2">
        {canModify && (
          <Button variant="outline" onClick={() => setDialog('upload')} className="pointer-coarse:h-11">
            <Upload /> 上传密钥
          </Button>
        )}
        {canModify && (
          <Button variant="outline" onClick={() => void check()} disabled={checking || !hasKey} title={hasKey ? undefined : '没有订阅密钥'} className="pointer-coarse:h-11">
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} 检查
          </Button>
        )}
        {canAudit && (
          <Button variant="outline" onClick={() => setDialog('report')} className="pointer-coarse:h-11">
            <FileText /> 系统报告
          </Button>
        )}
        {canModify && hasKey && (
          <Button variant="outline" onClick={() => setDialog('remove')} className="text-destructive hover:text-destructive pointer-coarse:h-11">
            <Trash2 /> 删除订阅
          </Button>
        )}
      </div>

      <UploadKeyDialog {...dialogProps('upload')} node={node} />
      <ConfirmDialog
        {...dialogProps('remove')}
        title="删除订阅密钥？"
        description={`从节点 ${node} 删除订阅密钥 ${data?.key ?? ''}。之后企业软件源将不可用，密钥可以重新上传。`}
        confirmLabel="删除"
        destructive
        onConfirm={() => runTask(removeSubscription(node), { title: `删除 ${node} 的订阅`, invalidate: subscriptionInvalidations(node), syncSuccessMessage: '订阅密钥已删除' })}
      />
      <SystemReportDialog {...dialogProps('report')} node={node} />
    </div>
  )
}

function UploadKeyDialog({ open, onOpenChange, node }: { open: boolean; onOpenChange: (o: boolean) => void; node: string }) {
  const [key, setKey] = useFormState(open, () => '')
  const [attempted, setAttempted] = useFormState(open, () => false)
  const trimmed = key.trim()
  const error = !trimmed ? '请输入订阅密钥' : SUBSCRIPTION_KEY_RE.test(trimmed) ? undefined : '格式如 pve2c-0123456789'
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="上传订阅密钥"
      description={`为节点 ${node} 设置订阅密钥，保存后立即联网校验。`}
      size="sm"
      submitLabel="上传"
      onSubmit={async () => {
        setAttempted(true)
        if (error) throw new ValidationError(error)
        await runTask(uploadSubscriptionKey(node, trimmed), {
          title: `上传 ${node} 的订阅密钥`,
          invalidate: subscriptionInvalidations(node),
          syncSuccessMessage: '订阅密钥已上传',
        })
      }}
    >
      <FormField label="订阅密钥" name="key" error={attempted ? error : undefined}>
        <FieldInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="pve2c-0123456789" autoComplete="off" spellCheck={false} className="font-mono" />
      </FormField>
    </FormDialog>
  )
}

// ------------------------------------------------------------ support

const LINKS = {
  portal: 'https://my.proxmox.com',
  forum: 'https://forum.proxmox.com',
  docs: 'https://pve.proxmox.com/pve-docs/',
  bugzilla: 'https://bugzilla.proxmox.com',
  pricing: 'https://www.proxmox.com/en/proxmox-virtual-environment/pricing',
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-strong hover:underline">
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  )
}

/** Datacenter → Support: what help is available, from the local node's subscription. */
export function SupportCard({ node }: { node: string | undefined }) {
  const sub = useSubscription(node)
  const data = sub.data
  const active = subscriptionActive(data)
  const community = active && data?.level === 'c'
  return (
    <GlassCard className="grid gap-3 text-sm" role="region" aria-label="支持">
      <div className="flex items-center gap-3">
        <IconTile icon={active ? LifeBuoy : CircleHelp} />
        <div className="min-w-0">
          <div className="font-medium">{sub.isPending ? '支持' : active ? (data?.productname ?? '已订阅') : '没有有效订阅'}</div>
          <div className="text-xs text-muted-foreground">按节点 {node ?? '—'} 的订阅判断</div>
        </div>
      </div>
      <p className="leading-relaxed text-muted-foreground">
        {active && !community ? (
          <>
            通过 <Ext href={LINKS.portal}>客户支持门户</Ext> 提交问题，也可以在 <Ext href={LINKS.forum}>社区论坛</Ext> 获取更多信息。
          </>
        ) : active ? (
          <>
            请在公开的 <Ext href={LINKS.forum}>社区论坛</Ext> 提问。
          </>
        ) : (
          <>
            没有订阅时可以在 <Ext href={LINKS.forum}>社区论坛</Ext> 获取帮助；需要企业软件源和官方技术支持请 <Ext href={LINKS.pricing}>购买订阅</Ext>。
          </>
        )}
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Ext href={LINKS.docs}>管理指南</Ext>
        <Ext href={LINKS.bugzilla}>问题跟踪（Bugzilla）</Ext>
      </p>
    </GlassCard>
  )
}
