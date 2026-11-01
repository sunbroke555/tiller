import { useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * App mark in a glass tile, following the theme accent: the tiller bar (a
 * server with its status light, cut out) over a tapering rudder of stacked
 * guests, reading as a T. Same drawing as public/favicon.svg.
 */
export function Logo({ className }: { className?: string }) {
  // useId() contains characters that url(#…) does not accept.
  const light = `tiller-light-${useId().replace(/[^\w-]/g, '')}`
  return (
    <span
      className={cn(
        'relative inline-flex size-9 items-center justify-center overflow-hidden rounded-xl',
        'bg-[radial-gradient(120%_120%_at_20%_10%,color-mix(in_oklab,var(--brand)_45%,transparent),transparent_70%)] bg-foreground/[0.06]',
        'ring-1 ring-foreground/10 ring-inset paper:bg-brand paper:ring-0',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 64 64" className="size-[62%] text-brand-strong paper:text-white" fill="currentColor">
        <mask id={light}>
          <rect width="64" height="64" fill="white" />
          <circle cx="47.5" cy="16.5" r="2.4" fill="black" />
        </mask>
        <rect x="8" y="10" width="48" height="13" rx="6.5" mask={`url(#${light})`} />
        <rect x="24" y="27.5" width="16" height="12" rx="4.5" opacity="0.72" />
        <rect x="26.5" y="43.5" width="11" height="11" rx="4" opacity="0.45" />
      </svg>
    </span>
  )
}
