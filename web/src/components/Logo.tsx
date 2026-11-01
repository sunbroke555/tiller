import { cn } from '@/lib/utils'

/** App mark: two server bays in a glass tile. Follows the theme accent. */
export function Logo({ className }: { className?: string }) {
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
      <svg viewBox="0 0 24 24" className="size-[60%] text-brand-strong paper:text-white" fill="none" stroke="currentColor" strokeWidth="2.2">
        <rect x="4" y="4.5" width="16" height="6" rx="1.8" />
        <rect x="4" y="13.5" width="16" height="6" rx="1.8" opacity="0.7" />
        <circle cx="16.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="16.5" cy="16.5" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    </span>
  )
}
