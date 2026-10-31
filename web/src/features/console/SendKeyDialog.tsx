import { useEffect, useState } from 'react'

import { sendQemuKey } from '@/api/console'
import { FieldInput, FormDialog, FormField } from '@/components/form'
import type { ActionDialogProps } from '@/components/page/registry'
import { runTask } from '@/components/tasks/tracker'
import type { GuestActionContext } from '@/features/guest/types'
import { cn } from '@/lib/utils'

import { SENDKEY_PRESETS, SENDKEY_TTYS, normalizeQemuKey } from './keys'

const ACTIVE = 'border-primary/60 bg-primary/10 ring-1 ring-primary/40'
const IDLE = 'border-border bg-(--field) hover:bg-accent'

interface SendKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  node: string
  vmid: number
  name: string
}

/**
 * PUT /nodes/{node}/qemu/{vmid}/sendkey: send a key combination to a running
 * VM without a console (presets plus any QEMU key name, e.g. ctrl-alt-f2).
 */
export function SendKeyDialog({ open, onOpenChange, node, vmid, name }: SendKeyDialogProps) {
  const [selected, setSelected] = useState<string>(SENDKEY_PRESETS[0]!.key)
  const [custom, setCustom] = useState('')
  useEffect(() => {
    if (open) {
      setSelected(SENDKEY_PRESETS[0]!.key)
      setCustom('')
    }
  }, [open])

  const customKey = custom.trim() ? normalizeQemuKey(custom) : null
  const key = custom.trim() ? customKey : selected
  const isActive = (k: string) => !custom.trim() && selected === k
  const pick = (k: string) => {
    setSelected(k)
    setCustom('')
  }
  const customError = custom.trim() && !customKey ? '格式：按键名用 - 连接，例如 ctrl-alt-f2、shift-tab' : undefined

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="发送按键"
      description={`向 ${name} 发送组合键，不需要打开控制台。`}
      submitLabel="发送"
      submitDisabled={!key}
      onSubmit={() =>
        runTask(sendQemuKey(node, vmid, key!), {
          title: `向 ${name} 发送 ${key}`,
          syncSuccessMessage: `已向 ${name} 发送 ${key}`,
          invalidate: [],
        })
      }
    >
      <div role="radiogroup" aria-label="组合键" className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SENDKEY_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={isActive(p.key)}
              onClick={() => pick(p.key)}
              className={cn(
                'flex min-h-14 min-w-0 flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors',
                isActive(p.key) ? ACTIVE : IDLE,
              )}
            >
              <span className="max-w-full truncate text-sm font-medium text-foreground tabular">{p.label}</span>
              {p.hint && <span className="max-w-full truncate text-xs text-muted-foreground">{p.hint}</span>}
            </button>
          ))}
        </div>
        <div>
          <div className="mb-2 text-sm font-medium text-foreground">
            切换虚拟终端 <span className="font-normal text-muted-foreground">Ctrl+Alt+F1–F7</span>
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {SENDKEY_TTYS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={isActive(p.key)}
                aria-label={p.hint}
                title={p.hint}
                onClick={() => pick(p.key)}
                className={cn(
                  'h-10 rounded-lg border text-sm font-medium text-foreground tabular transition-colors pointer-coarse:h-11',
                  isActive(p.key) ? ACTIVE : IDLE,
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <FormField label="其他组合键" name="key" hint="QEMU 按键名，例如 ctrl-alt-f8、alt-sysrq-h。" error={customError} className="mt-4">
        <FieldInput
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="ctrl-alt-f2"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="font-mono"
        />
      </FormField>
    </FormDialog>
  )
}

/** Guest action dialog ("发送按键…" in the action menu). */
export default function SendKeyActionDialog({ ctx, open, onOpenChange }: ActionDialogProps<GuestActionContext>) {
  return <SendKeyDialog open={open} onOpenChange={onOpenChange} node={ctx.node} vmid={ctx.vmid} name={ctx.name} />
}
