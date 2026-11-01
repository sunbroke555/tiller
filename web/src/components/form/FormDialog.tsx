import { createContext, use, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

import { isPveApiError } from '@/api/client'
import { ResponsiveDialog, type ResponsiveDialogProps } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'

import { FormError, FormErrorsContext } from './Field'

/**
 * True while the config the dialog was opened with has since been changed
 * elsewhere (its digest differs): saving will fail with a checksum mismatch.
 */
export const ConfigChangedContext = createContext(false)

export interface FormDialogProps extends Omit<ResponsiveDialogProps, 'footer' | 'wrap' | 'dismissible'> {
  /**
   * Runs on submit. While pending the dialog is busy and cannot be closed.
   * Resolve to close (unless closeOnSuccess is false); throw to stay open:
   * a PveApiError's field errors appear under the matching FormField `name`,
   * the message in a banner on top.
   */
  onSubmit: () => unknown | Promise<unknown>
  submitLabel?: string
  cancelLabel?: string
  /** Disable the submit button (form invalid / nothing changed). */
  submitDisabled?: boolean
  destructive?: boolean
  closeOnSuccess?: boolean
  /** Extra footer content on the left (e.g. a "重置" button). */
  footerExtra?: ReactNode
  /**
   * Unsaved input: closing by swipe, overlay tap or Escape asks first.
   * Default: true once the user typed into a field of this form.
   */
  dirty?: boolean
}

/**
 * ResponsiveDialog + <form>: Enter submits, busy state, inline API errors.
 *
 *   <FormDialog open={open} onOpenChange={setOpen} title="编辑内存"
 *     onSubmit={() => put(p`/nodes/${node}/qemu/${vmid}/config`, configUpdateParams(config, { memory }))}>
 *     <FormField label="内存" name="memory"><SizeInput value={memory} onChange={setMemory} /></FormField>
 *   </FormDialog>
 */
export function FormDialog({
  open,
  onOpenChange,
  onSubmit,
  submitLabel = '保存',
  cancelLabel = '取消',
  submitDisabled,
  destructive,
  closeOnSuccess = true,
  footerExtra,
  dirty,
  children,
  ...dialogProps
}: FormDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [typed, setTyped] = useState(false)
  const configChanged = use(ConfigChangedContext)

  useEffect(() => {
    if (!open) {
      setBusy(false)
      setError(null)
      setFieldErrors({})
      setTyped(false)
    }
  }, [open])

  async function submit() {
    if (busy || submitDisabled) return
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      await onSubmit()
      if (closeOnSuccess) onOpenChange(false)
    } catch (e) {
      if (isPveApiError(e) && e.errors) {
        setFieldErrors(e.errors)
        setError(e.message)
      } else {
        setError(errorMessage(e))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <ResponsiveDialog
      {...dialogProps}
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!busy}
      confirmDiscard={dirty ?? typed}
      wrap={(sections) => (
        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          // Typing marks the form dirty (selects and switches do not: they are
          // quick to redo, and a stray tap should still close the sheet).
          onInput={(e) => {
            if (!typed && e.target instanceof HTMLElement && e.target.matches('input, textarea')) setTyped(true)
          }}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {sections}
        </form>
      )}
      footer={
        <>
          {footerExtra && <div className="mr-auto hidden sm:flex">{footerExtra}</div>}
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || submitDisabled}>
            {busy && <Loader2 className="animate-spin" />}
            {submitLabel}
          </Button>
        </>
      }
    >
      <FormErrorsContext value={fieldErrors}>
        <div className="grid gap-5 pt-1 pb-2">
          {configChanged && !error && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-foreground"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
              配置已被修改（其他会话或任务）。保存会被拒绝，请关闭后重新打开再改。
            </p>
          )}
          {error && <FormError>{error}</FormError>}
          {children}
        </div>
      </FormErrorsContext>
    </ResponsiveDialog>
  )
}
