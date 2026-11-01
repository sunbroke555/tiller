import { useEffect, useId, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useKeyboardBox } from '@/hooks/useVisualViewport'
import { errorMessage } from '@/lib/errors'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button for stop/delete/reboot. */
  destructive?: boolean
  /**
   * Require typing this exact text (a guest name or ID) before confirming,
   * for irreversible actions such as delete.
   */
  typeToConfirm?: string
  /**
   * Runs on confirm. While its promise is pending the dialog stays open and
   * busy; on success it closes, on failure the error is shown as a toast and
   * the dialog stays open.
   */
  onConfirm: () => void | Promise<unknown>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  destructive,
  typeToConfirm,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const inputId = useId()
  // Phones: keep the dialog (and its confirm button) above the on-screen keyboard.
  const keyboard = useKeyboardBox(open && !!typeToConfirm)

  useEffect(() => {
    if (!open) {
      setTyped('')
      setBusy(false)
    }
  }, [open])

  const matches = !typeToConfirm || typed.trim() === typeToConfirm
  const canConfirm = matches && !busy

  async function confirm() {
    if (!canConfirm) return
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        style={
          keyboard.visible !== null
            ? { top: keyboard.top + keyboard.visible / 2, maxHeight: keyboard.visible - 16 }
            : undefined
        }
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void confirm()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
          </AlertDialogHeader>
          {typeToConfirm && (
            <div className="grid gap-2">
              {/* A plain block (not Label: flex + select-none): long volume names wrap and can be copied. */}
              <label htmlFor={inputId} className="block text-sm leading-relaxed text-muted-foreground">
                请输入{' '}
                <span className="font-mono font-medium break-all text-foreground select-all">{typeToConfirm}</span>{' '}
                以确认
              </label>
              <Input
                id={inputId}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>
              {cancelLabel}
            </AlertDialogCancel>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={!canConfirm}>
              {busy && <Loader2 className="animate-spin" />}
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
