import { useEffect, useId, useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'

import { powerCommand } from '@/api/guest-core'
import { useTasks } from '@/api/queries'
import {
  CheckboxField,
  FormDialog,
  FormField,
  FormSection,
  NumberInput,
  StorageSelect,
  SwitchField,
} from '@/components/form'
import type { ActionDialogProps } from '@/components/page/registry'
import { runTask } from '@/components/tasks/tracker'
import type { GuestActionContext } from '@/features/guest/types'
import { cn } from '@/lib/utils'

import {
  groupOf,
  powerModes,
  powerRequest,
  powerState,
  powerTitle,
  shutdownTaskType,
  type PowerMode,
  type PowerModeInfo,
} from './power'

const CONFIRM_LABEL: Record<PowerMode, string> = {
  shutdown: '关机',
  stop: '强制停止',
  pause: '暂停',
  hibernate: '休眠',
  reboot: '重启',
  reset: '重置',
}

interface PowerDialogProps extends ActionDialogProps<GuestActionContext> {
  /** Mode selected when the sheet opens; also picks the family (off / restart). */
  initial: PowerMode
}

/**
 * The power sheet: radio cards for the ways to turn a guest off (正常关机 /
 * 强制停止 / 暂停 / 休眠) or restart it (重启 / 重置), with the options of the
 * chosen mode. Bottom sheet on phones, dialog on desktop.
 */
export function PowerDialog({ ctx, open, onOpenChange, initial }: PowerDialogProps) {
  const { node, type, vmid, guest, name } = ctx
  const group = groupOf(initial)
  const state = powerState(guest)
  const modes = powerModes(group, type, state)
  const [mode, setMode] = useState<PowerMode>(initial)
  const [timeout, setTimeoutValue] = useState<number | undefined>()
  const [forceStop, setForceStop] = useState(false)
  const [statestorage, setStatestorage] = useState<string | undefined>()
  const haManaged = !!guest.hastate && guest.hastate !== 'unmanaged'

  // A shutdown task of this guest still running: "强制停止" may overrule it.
  const { data: tasks } = useTasks({ enabled: open && group === 'off' })
  const activeShutdown = useMemo(
    () =>
      (tasks ?? []).some(
        (t) => t.type === shutdownTaskType(type) && t.id === String(vmid) && !t.status && t.endtime === undefined,
      ),
    [tasks, type, vmid],
  )
  const [overrule, setOverrule] = useState(false)
  useEffect(() => {
    if (activeShutdown && !haManaged) setOverrule(true)
  }, [activeShutdown, haManaged])

  useEffect(() => {
    if (open) {
      setMode(initial)
      setTimeoutValue(undefined)
      setForceStop(false)
      setStatestorage(undefined)
    }
  }, [open, initial])

  const current = modes.find((m) => m.mode === mode) ?? modes[0]
  const kind = type === 'qemu' ? 'VM' : 'CT'

  const submit = () => {
    if (!current) return
    const { command, params } = powerRequest(current.mode, {
      timeout: current.mode === 'shutdown' ? timeout : undefined,
      forceStop: current.mode === 'shutdown' && forceStop,
      overruleShutdown: current.mode === 'stop' && activeShutdown && !haManaged && overrule,
      statestorage: current.mode === 'hibernate' ? statestorage : undefined,
    })
    return runTask(powerCommand(node, type, vmid, command, params), { title: powerTitle(current.mode, name) })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={group === 'off' ? `关闭 ${name}？` : `重启 ${name}？`}
      description={
        modes.length > 0
          ? `${kind} ${vmid} ${state.paused ? '已暂停' : '正在运行'}，选择${group === 'off' ? '关闭' : '重启'}方式`
          : undefined
      }
      size="sm"
      submitLabel={current ? CONFIRM_LABEL[current.mode] : '确认'}
      destructive={current?.destructive}
      submitDisabled={!current}
      onSubmit={submit}
    >
      {modes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{name} 当前{state.stopped ? '已停止' : '不在运行'}，无需操作。</p>
      ) : (
        <>
          <ModeCards modes={modes} value={current!.mode} onChange={setMode} />

          {current!.mode === 'shutdown' && (
            <FormSection collapsible title="高级选项">
              <FormField label="超时" hint="等待系统关机的最长时间，留空使用默认值。" name="timeout">
                <NumberInput value={timeout} onChange={setTimeoutValue} min={0} max={7200} unit="秒" placeholder="默认" />
              </FormField>
              <SwitchField
                label="超时后强制停止"
                description="超过时间仍未关机时直接断电。"
                checked={forceStop}
                onCheckedChange={setForceStop}
              />
            </FormSection>
          )}

          {current!.mode === 'stop' && activeShutdown && (
            <CheckboxField
              label="覆盖正在进行的关机任务"
              description={haManaged ? 'HA 管理的客户机不能覆盖关机任务。' : '先中止当前的关机任务，再立即停止。'}
              checked={overrule && !haManaged}
              disabled={haManaged}
              onCheckedChange={setOverrule}
            />
          )}

          {current!.mode === 'hibernate' && (
            <FormField label="状态存储" hint="保存内存镜像的存储，自动时使用配置的 vmstatestorage 或第一块磁盘所在的存储。">
              <StorageSelect
                node={node}
                content="images"
                value={statestorage}
                onValueChange={setStatestorage}
                emptyOption="自动"
              />
            </FormField>
          )}

          {haManaged && (
            <p className="flex items-start gap-2 rounded-xl bg-info/10 px-3 py-2.5 text-xs leading-relaxed text-foreground/85 paper:bg-secondary">
              <Info className="mt-px size-3.5 shrink-0 text-info" aria-hidden />
              这台客户机由 HA 管理（{guest.hastate}），操作会作为 HA 请求执行。
            </p>
          )}
        </>
      )}
    </FormDialog>
  )
}

/** Large tappable radio cards (≥64px), like the mockup's shutdown sheet. */
function ModeCards({
  modes,
  value,
  onChange,
}: {
  modes: PowerModeInfo[]
  value: PowerMode
  onChange: (mode: PowerMode) => void
}) {
  const id = useId()
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(v) => onChange(v as PowerMode)}
      aria-label="操作方式"
      className="grid gap-2"
    >
      {modes.map((m) => {
        const selected = m.mode === value
        return (
          <RadioGroupPrimitive.Item
            key={m.mode}
            value={m.mode}
            id={`${id}-${m.mode}`}
            aria-describedby={`${id}-${m.mode}-desc`}
            className={cn(
              'group flex min-h-16 w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left transition-[background-color,box-shadow] outline-none',
              'bg-foreground/[0.04] ring-1 ring-border/70 ring-inset hover:bg-foreground/[0.06] paper:bg-secondary/50',
              'focus-visible:ring-2 focus-visible:ring-ring',
              selected && !m.destructive && 'bg-brand/10 ring-2 ring-brand hover:bg-brand/12 paper:bg-brand/10',
              selected && m.destructive && 'bg-destructive/10 ring-2 ring-destructive hover:bg-destructive/12 paper:bg-destructive/10',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                selected ? (m.destructive ? 'border-destructive' : 'border-brand') : 'border-input',
              )}
            >
              <RadioGroupPrimitive.Indicator
                className={cn('block size-2.5 rounded-full', m.destructive ? 'bg-destructive' : 'bg-brand')}
              />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex items-center gap-2 text-[15px] font-medium text-foreground">
                {m.label}
                {m.recommended && (
                  <span className="rounded-full bg-success/12 px-1.5 py-0.5 text-[10px] leading-none font-medium text-success">
                    推荐
                  </span>
                )}
              </span>
              <span id={`${id}-${m.mode}-desc`} className="text-xs leading-relaxed text-muted-foreground">
                {m.description}
              </span>
            </span>
          </RadioGroupPrimitive.Item>
        )
      })}
    </RadioGroupPrimitive.Root>
  )
}

// One dialog component per entry point, so the action registry can open the
// sheet with the right mode preselected.
export const ShutdownDialog = (props: ActionDialogProps<GuestActionContext>) => <PowerDialog {...props} initial="shutdown" />
export const StopDialog = (props: ActionDialogProps<GuestActionContext>) => <PowerDialog {...props} initial="stop" />
export const PauseDialog = (props: ActionDialogProps<GuestActionContext>) => <PowerDialog {...props} initial="pause" />
export const HibernateDialog = (props: ActionDialogProps<GuestActionContext>) => <PowerDialog {...props} initial="hibernate" />
export const RebootDialog = (props: ActionDialogProps<GuestActionContext>) => <PowerDialog {...props} initial="reboot" />
export const ResetDialog = (props: ActionDialogProps<GuestActionContext>) => <PowerDialog {...props} initial="reset" />
