import { useState, type FocusEvent, type ReactNode } from 'react'

import { ConfirmDialog } from '@/components/ConfirmDialog'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useKeyboardBox } from '@/hooks/useVisualViewport'
import { cn } from '@/lib/utils'

export type ResponsiveDialogSize = 'sm' | 'md' | 'lg' | 'xl'

const DESKTOP_WIDTH: Record<ResponsiveDialogSize, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
}

export interface ResponsiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** Extra content on the header's right (a status badge, a toggle). */
  headerExtra?: ReactNode
  /** Scrollable body. */
  children?: ReactNode
  /** Sticky footer, usually buttons (rendered side by side, primary last). */
  footer?: ReactNode
  /** Desktop width; the mobile sheet is always full width. */
  size?: ResponsiveDialogSize
  /**
   * false while busy: Escape, overlay taps and swipe-down do nothing.
   * The caller still decides what onOpenChange does.
   */
  dismissible?: boolean
  /**
   * The body holds unsaved input: swipe-down is off and Escape, overlay taps
   * and the close button ask "放弃更改？" first. Explicit cancel buttons call
   * onOpenChange themselves and are not affected.
   */
  confirmDiscard?: boolean
  className?: string
  bodyClassName?: string
  /** Wrap header/body/footer, e.g. in a <form>. Receives the dialog's sections. */
  wrap?: (sections: ReactNode) => ReactNode
}

/**
 * Bottom sheet (vaul Drawer) on phones and tablets, centred Dialog on desktop
 * (≥1024px). The body scrolls between a fixed header and footer, so long forms
 * keep their buttons in reach; the sheet respects the home indicator.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  headerExtra,
  children,
  footer,
  size = 'md',
  dismissible = true,
  confirmDiscard = false,
  className,
  bodyClassName,
  wrap = (s) => s,
}: ResponsiveDialogProps) {
  const desktop = useIsDesktop()
  const keyboard = useKeyboardBox(open && !desktop)
  const [askDiscard, setAskDiscard] = useState(false)
  const guard = dismissible && confirmDiscard
  if (!open && askDiscard) setAskDiscard(false)
  const change = (o: boolean) => {
    if (!o && !dismissible) return
    if (!o && guard) {
      setAskDiscard(true)
      return
    }
    onOpenChange(o)
  }
  const discard = (
    <ConfirmDialog
      open={askDiscard && open}
      onOpenChange={setAskDiscard}
      title="放弃更改？"
      description="填写的内容还没有保存，关闭后会丢失。"
      confirmLabel="放弃"
      cancelLabel="继续编辑"
      destructive
      onConfirm={() => onOpenChange(false)}
    />
  )

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={change}>
        <DialogContent
          showCloseButton={dismissible}
          className={cn('flex max-h-[min(88dvh,56rem)] flex-col gap-0 p-0', DESKTOP_WIDTH[size], className)}
          onInteractOutside={(e) => !dismissible && e.preventDefault()}
        >
          {wrap(
            <>
              <DialogHeader className="shrink-0 gap-1.5 px-6 pt-6 pb-4 text-left">
                <div className="flex items-start gap-3 pr-8">
                  <DialogTitle className="min-w-0 flex-1 text-lg leading-tight">{title}</DialogTitle>
                  {headerExtra}
                </div>
                {description ? (
                  <DialogDescription>{description}</DialogDescription>
                ) : (
                  <DialogDescription className="sr-only">{title}</DialogDescription>
                )}
              </DialogHeader>
              <div data-slot="dialog-body" className={cn('min-h-0 flex-1 overflow-y-auto px-6 pb-2', bodyClassName)}>
                {children}
              </div>
              {footer && (
                <DialogFooter className="shrink-0 border-t border-border/60 px-6 py-4 sm:gap-2">{footer}</DialogFooter>
              )}
            </>,
          )}
        </DialogContent>
        {discard}
      </Dialog>
    )
  }

  // vaul's own keyboard handling (repositionInputs) resizes the drawer in
  // ways that fight the sticky footer, so it stays off; instead the sheet sits
  // on top of the on-screen keyboard and the focused field scrolls into view.
  const lifted = keyboard.inset > 0 && keyboard.visible !== null
  const revealFocused = (e: FocusEvent<HTMLDivElement>) => {
    const el = e.target
    if (!(el instanceof HTMLElement) || !el.matches('input, textarea, select, [contenteditable="true"]')) return
    // After the keyboard has opened and the sheet moved up.
    window.setTimeout(() => el.scrollIntoView({ block: 'nearest' }), 350)
  }
  return (
    <Drawer
      open={open}
      onOpenChange={change}
      // Guarded: no swipe-to-close; overlay taps and Escape ask first (below).
      dismissible={dismissible && !guard}
      repositionInputs={false}
    >
      <DrawerContent
        className={cn('max-h-[92dvh] outline-none', className)}
        style={lifted ? { bottom: keyboard.inset, maxHeight: Math.round(keyboard.visible! * 0.94) } : undefined}
        onFocus={revealFocused}
        // vaul cancels Radix's open auto-focus (so no keyboard pops up); move
        // focus into the sheet ourselves so the focus trap engages and screen
        // readers announce it. A field with autoFocus keeps its focus.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          const content = e.currentTarget as HTMLElement | null
          if (content && !content.contains(document.activeElement)) content.focus({ preventScroll: true })
        }}
        onPointerDownOutside={(e) => {
          if (guard) {
            e.preventDefault()
            setAskDiscard(true)
          }
        }}
        onEscapeKeyDown={(e) => {
          if (guard) {
            e.preventDefault()
            setAskDiscard(true)
          }
        }}
      >
        {wrap(
          <>
            <DrawerHeader className="shrink-0 gap-1 px-5 pt-3 pb-3 text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
              <div className="flex items-start gap-3">
                <DrawerTitle className="min-w-0 flex-1 text-lg leading-tight">{title}</DrawerTitle>
                {headerExtra}
              </div>
              {description ? (
                <DrawerDescription>{description}</DrawerDescription>
              ) : (
                <DrawerDescription className="sr-only">{title}</DrawerDescription>
              )}
            </DrawerHeader>
            <div
              data-slot="dialog-body"
              className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-3', !footer && 'safe-bottom', bodyClassName)}
            >
              {children}
            </div>
            {footer && (
              <DrawerFooter className="mt-0 shrink-0 flex-row gap-2 border-t border-border/60 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] *:flex-1">
                {footer}
              </DrawerFooter>
            )}
          </>,
        )}
      </DrawerContent>
      {discard}
    </Drawer>
  )
}
