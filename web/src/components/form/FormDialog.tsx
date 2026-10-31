import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

import { isPveApiError } from '@/api/client'
import { ResponsiveDialog, type ResponsiveDialogProps } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'

import { FormError, FormErrorsContext } from './Field'

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
  children,
  ...dialogProps
}: FormDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) {
      setBusy(false)
      setError(null)
      setFieldErrors({})
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
      wrap={(sections) => (
        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
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
          {error && <FormError>{error}</FormError>}
          {children}
        </div>
      </FormErrorsContext>
    </ResponsiveDialog>
  )
}
