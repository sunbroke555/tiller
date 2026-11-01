import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Box } from 'lucide-react'

import { createLxc, volumeLabel } from '@/api/guest-create'
import { FormError, FormErrorsContext, type VmidValidity } from '@/components/form'

import {
  LXC_STEPS,
  buildLxcParams,
  initialLxcForm,
  lxcStepOfParam,
  validateLxcStep,
  type LxcForm,
  type LxcStepId,
} from './lxc'
import { LxcCpuStep, LxcDisksStep, LxcDnsStep, LxcGeneralStep, LxcMemoryStep, LxcNetworkStep, LxcTemplateStep, type LxcStepProps } from './LxcSteps'
import { CreateStatus, ParamsList, ReviewSections, StartAfterCreate, type ReviewSectionData } from './Review'
import { useCreateFlow } from './useCreateFlow'
import { ServerErrorList, useWizardController } from './useWizardController'
import { Wizard } from './Wizard'

function mib(v: number | undefined): string {
  if (v === undefined) return '—'
  return v >= 1024 && v % 1024 === 0 ? `${v / 1024} GiB` : `${v} MiB`
}

const yes = (b: boolean) => (b ? '是' : '否')

function ipv4Text(form: LxcForm): string {
  return form.ipv4Mode === 'dhcp' ? 'DHCP' : form.ipv4Mode === 'static' ? form.ip : '不配置'
}

function ipv6Text(form: LxcForm): string {
  return { none: '不配置', dhcp: 'DHCP', auto: 'SLAAC', static: form.ip6 }[form.ipv6Mode]
}

function summaries(form: LxcForm): Partial<Record<LxcStepId, string>> {
  return {
    general: [form.node, form.vmid, form.hostname].filter(Boolean).join(' · '),
    template: form.ostemplate ? volumeLabel(form.ostemplate) : '',
    disks: [`rootfs ${form.rootSize ?? '?'}G`, ...form.mountPoints.map((m) => `mp${m.index} ${m.size ?? '?'}G`)].join('，'),
    cpu: form.cores ? `${form.cores} 核` : '不限',
    memory: `${mib(form.memory)} · 交换 ${mib(form.swap)}`,
    network: [form.bridge, `IPv4 ${ipv4Text(form)}`].filter(Boolean).join(' · '),
    dns: form.nameserver.trim() || form.searchdomain.trim() ? [form.searchdomain, form.nameserver].filter((s) => s.trim()).join(' · ') : '使用主机设置',
  }
}

function reviewSections(form: LxcForm, invalidSteps: Set<string>): ReviewSectionData[] {
  const idx = (id: LxcStepId) => LXC_STEPS.findIndex((s) => s.id === id)
  const section = (id: LxcStepId, rows: ReviewSectionData['rows']): ReviewSectionData => ({
    step: idx(id),
    title: LXC_STEPS[idx(id)]!.label,
    rows: rows.filter((r) => r.value !== null && r.value !== undefined && r.value !== ''),
    invalid: invalidSteps.has(id),
  })
  const keyCount = form.sshKeys.split('\n').filter((l) => l.trim()).length
  return [
    section('general', [
      { label: '节点', value: form.node },
      { label: 'CT ID', value: form.vmid },
      { label: '主机名', value: form.hostname || `CT${form.vmid ?? ''}` },
      { label: '非特权', value: yes(form.unprivileged) },
      { label: '嵌套', value: yes(form.unprivileged && form.nesting) },
      { label: 'root 认证', value: [form.password ? '密码' : null, keyCount ? `${keyCount} 个 SSH 公钥` : null].filter(Boolean).join(' + ') },
      { label: '资源池', value: form.pool },
      { label: '标签', value: form.tags.join('，') },
      { label: '加入 HA', value: form.haManaged ? '是' : '' },
    ]),
    section('template', [{ label: '模板', value: form.ostemplate ? volumeLabel(form.ostemplate) : '—', mono: true }]),
    section('disks', [
      { label: 'rootfs', value: `${form.rootStorage}，${form.rootSize ?? '?'} GiB` },
      ...form.mountPoints.map((m) => ({ label: `mp${m.index}`, value: `${m.path} · ${m.storage}，${m.size ?? '?'} GiB` })),
    ]),
    section('cpu', [
      { label: '核心', value: form.cores ? `${form.cores}` : '不限' },
      { label: 'CPU 限制', value: form.cpulimit ? `${form.cpulimit} 核` : '' },
      { label: 'CPU 权重', value: form.cpuunits },
    ]),
    section('memory', [
      { label: '内存', value: mib(form.memory) },
      { label: '交换', value: mib(form.swap) },
    ]),
    section('network', [
      { label: '网卡', value: `${form.netName} → ${form.bridge}${form.vlan ? `（VLAN ${form.vlan}）` : ''}` },
      { label: 'IPv4', value: ipv4Text(form) + (form.ipv4Mode === 'static' && form.gw ? `，网关 ${form.gw}` : ''), mono: form.ipv4Mode === 'static' },
      { label: 'IPv6', value: ipv6Text(form) + (form.ipv6Mode === 'static' && form.gw6 ? `，网关 ${form.gw6}` : ''), mono: form.ipv6Mode === 'static' },
      { label: 'MAC', value: form.hwaddr || '自动生成', mono: !!form.hwaddr },
      { label: '防火墙', value: yes(form.firewall) },
      { label: 'MTU', value: form.mtu },
      { label: '限速', value: form.rate ? `${form.rate} MB/s` : '' },
    ]),
    section('dns', [
      { label: 'DNS 域', value: form.searchdomain.trim() || '使用主机设置' },
      { label: 'DNS 服务器', value: form.nameserver.trim() || '使用主机设置', mono: !!form.nameserver.trim() },
    ]),
  ]
}

/** /create/lxc — the container creation wizard. */
export default function CreateLxcPage() {
  const [search] = useSearchParams()
  const [form, setForm] = useState<LxcForm>(() => initialLxcForm(search.get('node') ?? ''))
  const [vmidState, setVmidState] = useState<VmidValidity>('unknown')
  const flow = useCreateFlow('lxc')

  const set = useCallback((patch: Partial<LxcForm>) => setForm((f) => ({ ...f, ...patch })), [])
  const update = useCallback((fn: (f: LxcForm) => LxcForm) => setForm(fn), [])
  const validate = useCallback((id: LxcStepId) => validateLxcStep(id, form, { vmidState }), [form, vmidState])

  const params = useMemo(() => buildLxcParams(form), [form])
  const wizard = useWizardController({
    steps: LXC_STEPS,
    validate,
    serverErrors: flow.error?.fields,
    stepOfParam: lxcStepOfParam,
    onFinish: () =>
      void flow.submit(form.node, form.vmid!, () => createLxc(form.node, params), `创建容器 ${form.hostname || form.vmid}`),
  })

  const stepProps: LxcStepProps = { form, set, update }
  const step = LXC_STEPS[wizard.index]!.id
  const sums = summaries(form)

  return (
    <Wizard
      title="创建容器"
      eyebrow={
        <>
          <Box className="size-3.5" aria-hidden />
          <span>新容器{form.node ? ` · ${form.node}` : ''}</span>
        </>
      }
      steps={LXC_STEPS.map((s) => ({ ...s, summary: sums[s.id], invalid: wizard.invalid.has(s.id) }))}
      index={wizard.index}
      canJumpTo={wizard.canJumpTo}
      onJump={wizard.jump}
      onBack={wizard.back}
      onNext={wizard.next}
      finishLabel="创建容器"
      busy={flow.busy}
      locked={flow.busy}
    >
      <FormErrorsContext value={wizard.fieldErrors}>
        {step === 'general' && <LxcGeneralStep {...stepProps} onVmidValidity={setVmidState} />}
        {step === 'template' && <LxcTemplateStep {...stepProps} />}
        {step === 'disks' && <LxcDisksStep {...stepProps} />}
        {step === 'cpu' && <LxcCpuStep {...stepProps} />}
        {step === 'memory' && <LxcMemoryStep {...stepProps} />}
        {step === 'network' && <LxcNetworkStep {...stepProps} />}
        {step === 'dns' && <LxcDnsStep {...stepProps} />}
        {step === 'confirm' && (
          <div className="grid gap-5">
            <CreateStatus state={flow.state} what="容器" />
            {flow.error && (
              <FormError>
                <ServerErrorList error={flow.error} stepLabel={(p) => LXC_STEPS.find((s) => s.id === lxcStepOfParam(p))?.label} />
              </FormError>
            )}
            <ReviewSections sections={reviewSections(form, wizard.invalid)} onEdit={wizard.jump} disabled={flow.busy} />
            <StartAfterCreate checked={form.start} onChange={(start) => set({ start })} disabled={flow.busy} label="创建完成后立即启动容器" />
            <ParamsList params={params} secret={['password']} />
          </div>
        )}
      </FormErrorsContext>
    </Wizard>
  )
}
