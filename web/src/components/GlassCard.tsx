import type { ComponentProps } from 'react'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

interface GlassCardProps extends ComponentProps<'div'> {
  /** Floating, more opaque surface (sheets, palettes). */
  strong?: boolean
  /** Hover/press feedback for cards that are links or buttons. */
  interactive?: boolean
  /** No inner padding (lists that draw their own rows). */
  flush?: boolean
  /** Render the child element (e.g. a router <Link>) with the card styles. */
  asChild?: boolean
}

/**
 * The basic surface. Glass themes get a translucent card with a 1px highlight
 * on the top edge; paper and "glass off" get solid cards. Only floating,
 * strong surfaces blur the content behind them.
 */
export function GlassCard({ strong, interactive, flush, asChild, className, ...props }: GlassCardProps) {
  const Comp = asChild ? Slot.Root : 'div'
  return (
    <Comp
      data-slot="glass-card"
      className={cn(
        strong ? 'surface-strong' : 'surface',
        'rounded-2xl text-card-foreground',
        !flush && 'p-(--card-p)',
        interactive &&
          'block transition-[transform,background-color,box-shadow] duration-200 outline-none hover:bg-(--glass-strong) focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] paper:hover:bg-secondary/40',
        className,
      )}
      {...props}
    />
  )
}
