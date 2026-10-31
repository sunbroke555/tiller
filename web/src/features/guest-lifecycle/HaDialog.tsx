import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'

import { createHaResource, deleteHaResource, updateHaResource, useHaResource, type HaResource } from '@/api/guest-lifecycle'
import { FieldInput, FormDialog, FormField, FormRow, NumberInput, SelectField, SwitchField } from '@/components/form'
import type { ActionDialogProps } from '@/components/page/registry'
import { fireTask, runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { GuestActionContext } from '@/features/guest/types'

import { Notice } from './notes'
import { haParams } from './params'

const STATES: { value: NonNullable<HaResource['state']>; label: string; description: string }[] = [
  { value: 'started', label: '启动', description: '保持运行，故障时自动恢复' },
  { value: 'stopped', label: '停止', description: '保持停止' },
  { value: 'disabled', label: '禁用', description: '停止且不再恢复' },
  { value: 'ignored', label: '忽略', description: '暂时不由 HA 管理' },
]

/** Add the guest to HA or edit / remove its HA resource (sid vm:<id> / ct:<id>). */
export default function HaDialog({ ctx, open, onOpenChange }: ActionDialogProps<GuestActionContext>) {
  const { type, vmid, name } = ctx
  const sid = `${type === 'qemu' ? 'vm' : 'ct'}:${vmid}`
  const ha = useHaResource(sid, { enabled: open })
  const existing = ha.data ?? null
  const [state, setState] = useState<HaResource['state']>('started')
  const [maxRestart, setMaxRestart] = useState<number | undefined>(1)
  const [maxRelocate, setMaxRelocate] = useState<number | undefined>(1)
  const [failback, setFailback] = useState(true)
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (!open || ha.isPending) return
    setState(existing?.state ?? 'started')
    setMaxRestart(existing?.max_restart ?? 1)
    setMaxRelocate(existing?.max_relocate ?? 1)
    setFailback(existing ? existing.failback !== 0 : true)
    setComment(existing?.comment ?? '')
  }, [open, ha.isPending, existing?.digest])

  const submit = () => {
    const params = haParams({ state, maxRestart, maxRelocate, failback, comment }, existing)
    return existing
      ? runTask(updateHaResource(sid, params), { title: `更新 ${name} 的 HA 设置`, syncSuccessMessage: 'HA 设置已保存' })
      : runTask(createHaResource({ sid, ...params }), { title: `把 ${name} 加入 HA`, syncSuccessMessage: '已加入 HA' })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? `HA 设置 · ${name}` : `加入 HA · ${name}`}
      description="高可用：节点故障时自动在其他节点上恢复这台客户机。"
      size="md"
      submitLabel={existing ? '保存' : '加入 HA'}
      submitDisabled={ha.isPending}
      onSubmit={submit}
    >
      {ha.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <>
          {existing && <Notice tone="ok" title={`已由 HA 管理（${sid}）`} />}
          <FormField label="请求状态" name="state">
            <SelectField value={state} onValueChange={(v) => setState(v ?? 'started')} options={STATES} />
          </FormField>
          <FormRow>
            <FormField label="最多重启次数" name="max_restart" hint="在同一节点上重试启动的次数。">
              <NumberInput value={maxRestart} onChange={setMaxRestart} min={0} max={10} stepper />
            </FormField>
            <FormField label="最多迁移次数" name="max_relocate" hint="启动失败后换节点的次数。">
              <NumberInput value={maxRelocate} onChange={setMaxRelocate} min={0} max={10} stepper />
            </FormField>
          </FormRow>
          <SwitchField
            label="自动回迁"
            description="优先级更高的节点恢复在线后，自动迁回去（failback）。"
            checked={failback}
            onCheckedChange={setFailback}
          />
          <FormField label="备注" name="comment">
            <FieldInput value={comment} onChange={(e) => setComment(e.target.value)} placeholder="可选" />
          </FormField>
          {existing && (
            <div className="border-t border-border/60 pt-4">
              <Button
                type="button"
                variant="outline"
                className="w-full text-destructive hover:text-destructive sm:w-auto pointer-coarse:h-11"
                onClick={() => {
                  fireTask(deleteHaResource(sid), { title: `把 ${name} 移出 HA`, syncSuccessMessage: '已移出 HA' })
                  onOpenChange(false)
                }}
              >
                <Trash2 /> 移出 HA
              </Button>
            </div>
          )}
        </>
      )}
    </FormDialog>
  )
}
