// Ceph install wizard (official PVE.ceph.CephInstallWizard): pick release and
// repository, run `pveceph install` in the node shell (termproxy
// cmd=ceph_install), then create the initial configuration (public / cluster
// network, size, min_size) with the first monitor, and show the next steps.
// Only root@pam may run the install shell.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Check, CircleCheck, Loader2, SquareTerminal } from 'lucide-react'

import { cephErrorState, cephInit, cephKeys, createCephService, useCephMetadata, useNodeCephStatus } from '@/api/ceph'
import type { ConsoleTarget } from '@/api/console'
import { useNodeSubscription } from '@/api/node-summary'
import { useNodeNetworks } from '@/api/queries'
import { FieldInput, FormField, FormRow, FormSection, NodeSelect, NumberInput, SelectField } from '@/components/form'
import { GlassCard } from '@/components/GlassCard'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { ConsoleScreen } from '@/features/console/ConsoleScreen'
import { errorMessage } from '@/lib/errors'
import { nodePath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import {
  CEPH_RELEASES,
  CEPH_REPOSITORIES,
  defaultRelease,
  initFormError,
  initParams,
  installCmdOpts,
  isCidr,
  networkOfCidr,
  newestNodeVersion,
  repositoryHint,
  type CephRepository,
  type InitForm,
} from './model'
import { Fact, Notice, useCephAccess } from './ui'

const STEPS = ['版本', '安装', '配置', '完成'] as const

export function InstallWizard({ initialNode, base }: { initialNode?: string | undefined; base: string }) {
  const access = useCephAccess()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [node, setNode] = useState<string | undefined>(initialNode)
  const versions = useCephMetadata('versions')
  const clusterVersion = newestNodeVersion(versions.data)
  const [release, setRelease] = useState<string | null>(null)
  const [repo, setRepo] = useState<CephRepository>('enterprise')
  const subscription = useNodeSubscription(node ?? '', { enabled: !!node })
  const hasSubscription = subscription.data?.status === 'active'
  const [repoTouched, setRepoTouched] = useState(false)

  // No subscription: the enterprise repository would fail; preselect no-subscription.
  useEffect(() => {
    if (!repoTouched && subscription.data) setRepo(hasSubscription ? 'enterprise' : 'no-subscription')
  }, [subscription.data, hasSubscription, repoTouched])
  const chosenRelease = release ?? defaultRelease(clusterVersion)

  // Install state of the node: polled fast while the shell runs.
  const nodeStatus = useNodeCephStatus(node, { refetchInterval: step === 1 ? 2_000 : 10_000 })
  const state = nodeStatus.data ? 'ok' : nodeStatus.error ? cephErrorState(nodeStatus.error) : null
  const installed = state !== null && state !== 'not-installed'
  /** A configuration (ceph.conf) exists: the configuration step is skipped. */
  const configured = state === 'ok' || state === 'unreachable'

  const target = useMemo<ConsoleTarget | null>(
    () => (node ? { kind: 'node', node, cmd: 'ceph_install', cmdOpts: installCmdOpts(chosenRelease, repo) } : null),
    [node, chosenRelease, repo],
  )

  const releaseInfo = CEPH_RELEASES.find((r) => r.release === chosenRelease)
  const hint = repositoryHint(repo, hasSubscription)

  return (
    <div className="grid min-w-0 gap-(--section-gap)" data-testid="ceph-install-wizard">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label="安装步骤">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2" aria-current={i === step ? 'step' : undefined}>
            <span
              className={cn(
                'inline-flex size-6 items-center justify-center rounded-full text-xs tabular',
                i < step ? 'bg-success/15 text-success-strong' : i === step ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground',
              )}
            >
              {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cn(i === step ? 'font-medium' : 'text-muted-foreground')}>{s}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-border sm:w-8" aria-hidden />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <GlassCard className="grid gap-4">
          <div>
            <h2 className="text-base font-semibold">在节点上安装 Ceph</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ceph 是分布式存储：把多台节点的磁盘组成一个高可用的存储池，供虚拟机磁盘（RBD）和共享文件系统（CephFS）使用。每个要运行 Ceph 服务的节点都需要安装一次。
            </p>
          </div>
          {!access.isRoot && <Notice tone="warn">安装需要以 root@pam 登录（安装程序在节点 Shell 中运行）。</Notice>}
          <FormRow>
            <FormField label="节点" required>
              <NodeSelect value={node} onValueChange={setNode} />
            </FormField>
            <FormField label="集群中的 Ceph" hint="已安装节点中最新的版本">
              <div className="flex h-10 items-center text-sm">{clusterVersion ?? '尚未安装'}</div>
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="Ceph 版本" required>
              <SelectField
                value={chosenRelease}
                onValueChange={(v) => v && setRelease(v)}
                options={CEPH_RELEASES.map((r) => ({ value: r.release, label: `${r.release} (${r.version})` }))}
                aria-label="Ceph 版本"
              />
            </FormField>
            <FormField label="软件源" required>
              <SelectField
                value={repo}
                onValueChange={(v) => {
                  setRepoTouched(true)
                  if (v) setRepo(v)
                }}
                options={CEPH_REPOSITORIES.filter((r) => !(releaseInfo?.preview && r.value === 'enterprise')).map((r) => ({
                  value: r.value,
                  label: r.label,
                  description: r.description,
                }))}
                aria-label="软件源"
              />
            </FormField>
          </FormRow>
          {hint && <Notice tone={repo === 'enterprise' ? 'warn' : 'info'}>{hint}</Notice>}
          {clusterVersion && releaseInfo && !clusterVersion.startsWith(releaseInfo.version) && (
            <Notice tone="warn">集群中已运行 Ceph {clusterVersion}，所有节点应使用同一个大版本。</Notice>
          )}
          {node && installed && <Notice tone="info">{node} 上已经安装了 Ceph，下一步会跳过安装。</Notice>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => navigate(base)}>
              取消
            </Button>
            <Button
              onClick={() => setStep(1)}
              disabled={!node || nodeStatus.isPending || (!installed && !access.isRoot)}
              data-testid="ceph-install-start"
            >
              {installed ? '下一步' : `开始安装 ${chosenRelease}`}
            </Button>
          </div>
        </GlassCard>
      )}

      {step === 1 && node && (
        <div className="grid gap-3">
          <InstallStep node={node} target={target} installed={installed} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {installed ? (
              <span className="mr-auto inline-flex items-center gap-1.5 text-sm text-success-strong" role="status">
                <CircleCheck className="size-4" aria-hidden /> Ceph 已安装
              </span>
            ) : (
              <span className="mr-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden /> 等待安装完成…（在终端里按提示确认）
              </span>
            )}
            <Button variant="ghost" onClick={() => setStep(0)}>
              上一步
            </Button>
            <Button onClick={() => setStep(configured ? 3 : 2)} disabled={!installed} data-testid="ceph-install-next">
              下一步
            </Button>
          </div>
        </div>
      )}

      {step === 2 && node && <ConfigStep node={node} onBack={() => setStep(1)} onDone={() => setStep(3)} />}

      {step === 3 && node && (
        <GlassCard className="grid gap-4">
          <div className="flex items-start gap-3">
            <CircleCheck className="size-8 shrink-0 text-success-strong" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">安装完成</h2>
              <p className="mt-1 text-sm text-muted-foreground">{node} 上的 Ceph 已就绪。接下来通常还需要：</p>
            </div>
          </div>
          <ol className="grid list-decimal gap-1.5 pl-5 text-sm">
            <li>在其他节点上安装 Ceph（每个节点运行一次本向导）</li>
            <li>
              <Link className="text-brand-strong underline-offset-2 hover:underline" to={`${base}/services`}>
                再创建两个监视器
              </Link>
              （共 3 个，分布在不同节点）
            </li>
            <li>
              <Link className="text-brand-strong underline-offset-2 hover:underline" to={`${base}/osd`}>
                在每个节点上创建 OSD
              </Link>
            </li>
            <li>
              <Link className="text-brand-strong underline-offset-2 hover:underline" to={`${base}/pools`}>
                创建存储池
              </Link>
              ，并添加为存储
            </li>
          </ol>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" asChild>
              <Link to={nodePath(node, 'ceph')}>查看节点 Ceph</Link>
            </Button>
            <Button asChild>
              <Link to={base}>完成</Link>
            </Button>
          </div>
        </GlassCard>
      )}
    </div>
  )
}

/** The install shell, or a note when Ceph is already there. */
function InstallStep({ node, target, installed }: { node: string; target: ConsoleTarget | null; installed: boolean }) {
  // Keep the shell once it was opened, even after the status flips to installed.
  const [opened] = useState(() => !installed)
  if (!opened || !target) {
    return (
      <GlassCard className="flex items-center gap-3">
        <CircleCheck className="size-6 shrink-0 text-success-strong" aria-hidden />
        <p className="text-sm">{node} 上已经安装了 Ceph，点“下一步”创建或检查配置。</p>
      </GlassCard>
    )
  }
  return (
    <div className="grid gap-2">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <SquareTerminal className="size-4" aria-hidden />
        在 {node} 上运行 pveceph install。安装程序会询问是否继续，输入 Y 回车。
      </p>
      <ConsoleScreen key={`${node}:${target.kind === 'node' ? target.cmdOpts : ''}`} target={target} variant="embedded" title={`${node} · 安装 Ceph`} />
    </div>
  )
}

function ConfigStep({ node, onBack, onDone }: { node: string; onBack: () => void; onDone: () => void }) {
  const networks = useNodeNetworks(node, 'include_sdn')
  const [form, setForm] = useState<InitForm>({ network: '', clusterNetwork: '', size: null, minSize: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof InitForm>(k: K, v: InitForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const detected = useMemo(() => {
    const out: { cidr: string; label: string }[] = []
    for (const n of networks.data ?? []) {
      for (const c of [n.cidr, n.cidr6]) {
        if (!c) continue
        const net = networkOfCidr(c)
        if (!out.some((o) => o.cidr === net)) out.push({ cidr: net, label: `${n.iface} · ${c.split('/')[0]}` })
      }
    }
    return out
  }, [networks.data])
  // Preselect the network of the first interface with an address (official: none; this saves a tap).
  useEffect(() => {
    if (!form.network && detected[0]) set('network', detected[0].cidr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected])

  const formError = initFormError(form)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await cephInit(node, initParams(form))
      const handle = await runTask(createCephService(node, 'mon', node), { title: `创建监视器 ${node}`, node, invalidate: [cephKeys.all()] })
      const outcome = await handle.done
      if (outcome.state === 'error') throw new Error(`创建监视器失败：${outcome.exitstatus ?? ''}`)
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <GlassCard className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold">初始配置</h2>
        <p className="mt-1 text-sm text-muted-foreground">创建 /etc/pve/ceph.conf，并在 {node} 上创建第一个监视器（和管理器）。</p>
      </div>
      <FormField label="公共网络" required hint="Ceph 客户端和监视器使用的网络（CIDR）" error={form.network && !isCidr(form.network) ? '应为 CIDR，例如 10.10.10.0/24' : undefined}>
        <FieldInput value={form.network} onChange={(e) => set('network', e.target.value)} placeholder="10.10.10.0/24" autoCapitalize="off" spellCheck={false} aria-label="公共网络" />
      </FormField>
      {detected.length > 0 && (
        <div className="-mt-2 flex flex-wrap gap-1.5" aria-label="检测到的网络">
          {detected.map((d) => (
            <button
              key={d.cidr}
              type="button"
              onClick={() => set('network', d.cidr)}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs ring-1 ring-border ring-inset hover:bg-foreground/[0.04] pointer-coarse:min-h-10',
                form.network === d.cidr && 'bg-brand/12 text-brand-strong ring-brand/40 paper:bg-secondary paper:text-foreground',
              )}
            >
              <span className="font-mono">{d.cidr}</span>
              <span className="text-muted-foreground">{d.label}</span>
            </button>
          ))}
        </div>
      )}
      <FormField label="集群网络" hint="OSD 之间复制和恢复数据的网络；留空则与公共网络相同" error={form.clusterNetwork && !isCidr(form.clusterNetwork) ? '应为 CIDR' : undefined}>
        <FieldInput value={form.clusterNetwork} onChange={(e) => set('clusterNetwork', e.target.value)} placeholder="与公共网络相同" autoCapitalize="off" spellCheck={false} aria-label="集群网络" />
      </FormField>
      <div className="grid grid-cols-2 gap-2">
        <Fact label="监视器节点">{node}</Fact>
        <Fact label="提示">之后可以在“服务”里添加更多监视器</Fact>
      </div>
      <FormSection title="高级选项" collapsible>
        <FormRow>
          <FormField label="副本数" hint="新存储池的默认 size（默认 3）">
            <NumberInput value={form.size} onChange={(v) => set('size', v ?? null)} min={2} max={7} placeholder="3" stepper aria-label="副本数" />
          </FormField>
          <FormField label="最小副本数" hint="默认 min_size（默认 2）">
            <NumberInput value={form.minSize} onChange={(v) => set('minSize', v ?? null)} min={2} max={Math.min(form.size ?? 3, 4)} placeholder="2" stepper aria-label="最小副本数" />
          </FormField>
        </FormRow>
      </FormSection>
      {error && <Notice tone="err">{error}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          上一步
        </Button>
        <Button onClick={() => void submit()} disabled={!!formError || busy} data-testid="ceph-init-submit">
          {busy && <Loader2 className="animate-spin" />}
          创建配置
        </Button>
      </div>
    </GlassCard>
  )
}
