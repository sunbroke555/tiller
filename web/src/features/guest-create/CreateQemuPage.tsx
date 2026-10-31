import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Monitor } from 'lucide-react'

import { createQemu, volumeLabel } from '@/api/guest-create'
import { FormError, FormErrorsContext, type VmidValidity } from '@/components/form'

import {
  BUS_LABEL,
  QEMU_STEPS,
  SCSIHW_OPTIONS,
  VGA_OPTIONS,
  buildQemuParams,
  initialQemuForm,
  nicModelLabel,
  ostypeLabel,
  qemuStepOfParam,
  validateQemuStep,
  type QemuForm,
  type QemuStepId,
} from './qemu'
import {
  QemuCpuStep,
  QemuDisksStep,
  QemuGeneralStep,
  QemuMemoryStep,
  QemuNetworkStep,
  QemuOsStep,
  QemuSystemStep,
  type QemuStepProps,
} from './QemuSteps'
import { CreateStatus, ParamsList, ReviewSections, StartAfterCreate, type ReviewSectionData } from './Review'
import { useCreateFlow } from './useCreateFlow'
import { ServerErrorList, useWizardController } from './useWizardController'
import { Wizard } from './Wizard'

function mib(v: number | undefined): string {
  if (v === undefined) return '—'
  return v >= 1024 && v % 1024 === 0 ? `${v / 1024} GiB` : `${v} MiB`
}

const yes = (b: boolean) => (b ? '是' : '否')

/** One-line summaries for the step rail. */
function summaries(form: QemuForm): Partial<Record<QemuStepId, string>> {
  const total = (form.sockets ?? 1) * (form.cores ?? 1)
  return {
    general: [form.node, form.vmid, form.name].filter(Boolean).join(' · '),
    os: [form.media === 'iso' ? (form.iso ? volumeLabel(form.iso) : 'ISO') : form.media === 'cdrom' ? '物理光驱' : '无介质', ostypeLabel(form.ostype)].join(' · '),
    system: [form.machine || 'i440fx', form.bios === 'ovmf' ? 'UEFI' : 'SeaBIOS'].join(' · '),
    disks: form.disks.length ? form.disks.map((d) => `${d.bus}${d.index} ${d.size ?? '?'}G`).join('，') : '无磁盘',
    cpu: `${total} 核 · ${form.cputype}`,
    memory: mib(form.memory),
    network: form.noNetwork ? '无网卡' : [form.bridge, form.vlan ? `VLAN ${form.vlan}` : null, form.model].filter(Boolean).join(' · '),
  }
}

function reviewSections(form: QemuForm, invalidSteps: Set<string>): ReviewSectionData[] {
  const idx = (id: QemuStepId) => QEMU_STEPS.findIndex((s) => s.id === id)
  const total = (form.sockets ?? 1) * (form.cores ?? 1)
  const section = (id: QemuStepId, rows: ReviewSectionData['rows']): ReviewSectionData => ({
    step: idx(id),
    title: QEMU_STEPS[idx(id)]!.label,
    rows: rows.filter((r) => r.value !== null && r.value !== undefined && r.value !== ''),
    invalid: invalidSteps.has(id),
  })
  return [
    section('general', [
      { label: '节点', value: form.node },
      { label: 'VM ID', value: form.vmid },
      { label: '名称', value: form.name || '未命名' },
      { label: '资源池', value: form.pool },
      { label: '标签', value: form.tags.join('，') },
      { label: '开机自启', value: yes(form.onboot) },
      { label: '加入 HA', value: form.haManaged ? '是' : '' },
    ]),
    section('os', [
      {
        label: '安装介质',
        value: form.media === 'iso' ? (form.iso ? volumeLabel(form.iso) : '—') : form.media === 'cdrom' ? '物理光驱' : '不使用',
        mono: form.media === 'iso',
      },
      { label: '系统类型', value: ostypeLabel(form.ostype) },
      { label: '驱动光驱', value: form.virtioIso ? volumeLabel(form.virtioIsoVolume) : '', mono: true },
    ]),
    section('system', [
      { label: '显卡', value: VGA_OPTIONS.find((o) => o.value === form.vga)?.label ?? '默认' },
      { label: '机器', value: form.machineVersion || form.machine || '默认 (i440fx)' },
      { label: 'BIOS', value: form.bios === 'ovmf' ? 'OVMF (UEFI)' : form.bios === 'seabios' ? 'SeaBIOS' : '默认 (SeaBIOS)' },
      { label: 'EFI 磁盘', value: form.bios === 'ovmf' ? (form.efiDisk ? form.efiStorage : '不添加') : '' },
      { label: 'SCSI 控制器', value: SCSIHW_OPTIONS.find((o) => o.value === form.scsihw)?.label ?? '默认 (LSI 53C895A)' },
      { label: 'Guest Agent', value: yes(form.agent) },
      { label: 'TPM', value: form.tpm ? `${form.tpmStorage} · ${form.tpmVersion}` : '' },
    ]),
    section(
      'disks',
      form.disks.length
        ? form.disks.map((d) => ({
            label: `${d.bus}${d.index}`,
            value: [
              `${d.storage}，${d.size ?? '?'} GiB`,
              BUS_LABEL[d.bus],
              d.format || null,
              d.discard ? 'Discard' : null,
              d.iothread && (d.bus === 'scsi' || d.bus === 'virtio') ? 'IO thread' : null,
              d.ssd && d.bus !== 'virtio' ? 'SSD' : null,
              d.cache ? `缓存 ${d.cache}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
          }))
        : [{ label: '磁盘', value: '不添加' }],
    ),
    section('cpu', [
      { label: '核心', value: `${form.sockets ?? 1} 插槽 × ${form.cores ?? 1} 核 = ${total}` },
      { label: '类型', value: form.cputype },
      { label: 'vCPU', value: form.vcpus },
      { label: 'CPU 限制', value: form.cpulimit ? `${form.cpulimit} 核` : '' },
      { label: 'CPU 权重', value: form.cpuunits },
      { label: 'CPU 亲和', value: form.affinity },
      { label: 'NUMA', value: form.numa ? '启用' : '' },
      {
        label: 'CPU 标志',
        value: Object.entries(form.cpuFlags)
          .map(([k, v]) => `${v}${k}`)
          .join(' '),
        mono: true,
      },
    ]),
    section('memory', [
      { label: '内存', value: mib(form.memory) },
      {
        label: 'Ballooning',
        value: form.ballooning ? (form.balloon !== form.memory ? `最小 ${mib(form.balloon)}` : '启用') : '关闭',
      },
      { label: 'KSM', value: form.allowKsm ? '允许' : '不允许' },
    ]),
    section(
      'network',
      form.noNetwork
        ? [{ label: '网卡', value: '不添加' }]
        : [
            { label: '网桥', value: form.bridge },
            { label: 'VLAN', value: form.vlan },
            { label: '型号', value: nicModelLabel(form.model) },
            { label: 'MAC', value: form.macaddr || '自动生成', mono: !!form.macaddr },
            { label: '防火墙', value: yes(form.firewall) },
            { label: '断开连接', value: form.disconnect ? '是' : '' },
            { label: 'MTU', value: form.mtu },
            { label: '限速', value: form.rate ? `${form.rate} MB/s` : '' },
            { label: '多队列', value: form.queues },
          ],
    ),
  ]
}

/** /create/qemu — the VM creation wizard. */
export default function CreateQemuPage() {
  const [search] = useSearchParams()
  const [form, setForm] = useState<QemuForm>(() => initialQemuForm(search.get('node') ?? ''))
  const [vmidState, setVmidState] = useState<VmidValidity>('unknown')
  const flow = useCreateFlow('qemu')

  const set = useCallback((patch: Partial<QemuForm>) => setForm((f) => ({ ...f, ...patch })), [])
  const update = useCallback((fn: (f: QemuForm) => QemuForm) => setForm(fn), [])
  const validate = useCallback((id: QemuStepId) => validateQemuStep(id, form, { vmidState }), [form, vmidState])

  const params = useMemo(() => buildQemuParams(form), [form])
  const wizard = useWizardController({
    steps: QEMU_STEPS,
    validate,
    serverErrors: flow.error?.fields,
    stepOfParam: qemuStepOfParam,
    onFinish: () =>
      void flow.submit(form.node, form.vmid!, () => createQemu(form.node, params), `创建虚拟机 ${form.name || form.vmid}`),
  })

  const stepProps: QemuStepProps = { form, set, update }
  const step = QEMU_STEPS[wizard.index]!.id
  const sums = summaries(form)

  return (
    <Wizard
      title="创建虚拟机"
      eyebrow={<Monitor className="size-3.5" aria-hidden />}
      steps={QEMU_STEPS.map((s) => ({ ...s, summary: sums[s.id], invalid: wizard.invalid.has(s.id) }))}
      index={wizard.index}
      canJumpTo={wizard.canJumpTo}
      onJump={wizard.jump}
      onBack={wizard.back}
      onNext={wizard.next}
      finishLabel="创建虚拟机"
      busy={flow.busy}
      locked={flow.busy}
    >
      <FormErrorsContext value={wizard.fieldErrors}>
        {step === 'general' && <QemuGeneralStep {...stepProps} onVmidValidity={setVmidState} />}
        {step === 'os' && <QemuOsStep {...stepProps} />}
        {step === 'system' && <QemuSystemStep {...stepProps} />}
        {step === 'disks' && <QemuDisksStep {...stepProps} />}
        {step === 'cpu' && <QemuCpuStep {...stepProps} />}
        {step === 'memory' && <QemuMemoryStep {...stepProps} />}
        {step === 'network' && <QemuNetworkStep {...stepProps} />}
        {step === 'confirm' && (
          <div className="grid gap-5">
            <CreateStatus state={flow.state} what="虚拟机" />
            {flow.error && (
              <FormError>
                <ServerErrorList error={flow.error} stepLabel={(p) => QEMU_STEPS.find((s) => s.id === qemuStepOfParam(p))?.label} />
              </FormError>
            )}
            <ReviewSections sections={reviewSections(form, wizard.invalid)} onEdit={wizard.jump} disabled={flow.busy} />
            <StartAfterCreate
              checked={form.start}
              onChange={(start) => set({ start })}
              disabled={flow.busy}
              label="创建完成后立即开机"
            />
            <ParamsList params={params} />
          </div>
        )}
      </FormErrorsContext>
    </Wizard>
  )
}
