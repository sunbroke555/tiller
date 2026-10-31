import type { ReactNode } from 'react'

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
  className,
  bodyClassName,
  wrap = (s) => s,
}: ResponsiveDialogProps) {
  const desktop = useIsDesktop()
  const change = (o: boolean) => {
    if (!o && !dismissible) return
    onOpenChange(o)
  }

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
      </Dialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={change} dismissible={dismissible} repositionInputs={false}>
      <DrawerContent className={cn('max-h-[92dvh]', className)}>
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
    </Drawer>
  )
}
