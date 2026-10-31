import { Lock, Shield, ShieldAlert, ShieldCheck } from 'lucide-react'

import type { StorageVolume } from '@/api/storage-browser'
import { cn } from '@/lib/utils'

const BADGE = 'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] leading-none'

/** Protected / encrypted / verify-state badges of a backup. */
export function VolumeBadges({ volume: v, className }: { volume: StorageVolume; className?: string }) {
  const state = v.verification?.state
  if (v.protected !== 1 && !v.encrypted && !state) return null
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {v.protected === 1 && (
        <span className={cn(BADGE, 'bg-info/12 text-info paper:bg-secondary paper:text-foreground/75')}>
          <Shield className="size-3" aria-hidden />
          受保护
        </span>
      )}
      {v.encrypted && (
        <span className={cn(BADGE, 'bg-secondary text-secondary-foreground')} title={`已加密（${v.encrypted}）`}>
          <Lock className="size-3" aria-hidden />
          加密
        </span>
      )}
      {state === 'ok' && (
        <span className={cn(BADGE, 'bg-success/12 text-success paper:bg-secondary')}>
          <ShieldCheck className="size-3" aria-hidden />
          已校验
        </span>
      )}
      {state === 'failed' && (
        <span className={cn(BADGE, 'bg-destructive/12 text-destructive paper:bg-secondary')}>
          <ShieldAlert className="size-3" aria-hidden />
          校验失败
        </span>
      )}
    </span>
  )
}
