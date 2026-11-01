// Cluster resource scheduling (crs in /cluster/options), the official "CRS Settings".

import { useEffect, useState } from 'react'

import { saveCrsOptions, useCrsOptions } from '@/api/ha'
import { clusterOptionsKey } from '@/api/shell'
import { FormDialog, FormField, FormRow, NumberInput, SelectField, SwitchField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Skeleton } from '@/components/ui/skeleton'

import { CRS_MODE_LABEL, canAutoRebalance, crsForm, crsParams, type CrsForm, type CrsMethod, type CrsMode } from './logic'

const MODES = (Object.keys(CRS_MODE_LABEL) as CrsMode[]).map((m) => ({
  value: m,
  label: CRS_MODE_LABEL[m],
  description: m === 'basic' ? '按节点上的 HA 资源数量' : m === 'static' ? '按配置的 CPU 和内存' : '按实际 CPU 和内存负载',
}))

const METHODS: { value: CrsMethod; label: string }[] = [
  { value: 'bruteforce', label: 'Bruteforce' },
  { value: 'topsis', label: 'TOPSIS' },
]

export function CrsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const options = useCrsOptions(open)
  const [form, setForm] = useState<CrsForm>(() => crsForm(undefined))
  const set = <K extends keyof CrsForm>(k: K, v: CrsForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  useEffect(() => {
    if (open && options.data) setForm(crsForm(options.data.crs))
  }, [open, !!options.data, options.data?.crs])

  const auto = canAutoRebalance(form.mode)
  const autoOn = auto && form.autoRebalance

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="集群资源调度（CRS）"
      description="决定 HA 资源恢复、启动和均衡时选择哪个节点。保存在数据中心选项里。"
      size="md"
      submitLabel="保存"
      submitDisabled={options.isPending}
      onSubmit={() =>
        runTask(saveCrsOptions(crsParams(form)), { title: '保存 CRS 设置', syncSuccessMessage: 'CRS 设置已保存', invalidate: [clusterOptionsKey()] })
      }
    >
      {options.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <>
          <FormField label="调度模式" name="ha">
            <SelectField value={form.mode} onValueChange={(v) => set('mode', v)} options={MODES} emptyOption="默认（基础）" />
          </FormField>
          <SwitchField
            label="启动时均衡"
            description="启动 HA 资源时用 CRS 选负载最低的节点。"
            checked={form.rebalanceOnStart}
            onCheckedChange={(v) => set('rebalanceOnStart', v)}
          />
          <SwitchField
            label="自动均衡"
            description={auto ? '负载不均时自动迁移 HA 资源。' : '只有静态负载和动态负载模式支持自动均衡。'}
            checked={autoOn}
            disabled={!auto}
            onCheckedChange={(v) => set('autoRebalance', v)}
          />
          {autoOn && (
            <>
              <FormRow>
                <FormField label="不均衡阈值" name="ha-auto-rebalance-threshold" hint="默认 30%">
                  <NumberInput value={form.threshold} onChange={(v) => set('threshold', v)} min={0} max={100} unit="%" />
                </FormField>
                <FormField label="最小改善" name="ha-auto-rebalance-margin" hint="默认 10%">
                  <NumberInput value={form.margin} onChange={(v) => set('margin', v)} min={0} max={100} unit="%" />
                </FormField>
              </FormRow>
              <FormRow>
                <FormField label="均衡算法" name="ha-auto-rebalance-method">
                  <SelectField value={form.method} onValueChange={(v) => set('method', v)} options={METHODS} emptyOption="默认（Bruteforce）" />
                </FormField>
                <FormField label="保持轮数" name="ha-auto-rebalance-hold-duration" hint="默认 3">
                  <NumberInput value={form.holdDuration} onChange={(v) => set('holdDuration', v)} min={0} />
                </FormField>
              </FormRow>
            </>
          )}
        </>
      )}
    </FormDialog>
  )
}
