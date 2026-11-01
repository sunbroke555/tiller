import type { ReactNode } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'

import { usePermissions } from '@/api/permissions'
import { useSession } from '@/api/useSession'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { HealthTone } from './model'

/** What the current user may do here (official checks: Sys.Modify on /, Datastore.Allocate on /storage). */
export interface DiskPermissions {
  /** Create / destroy storages, initialise GPT. */
  modify: boolean
  /** add_storage and cleanup-config also need Datastore.Allocate on /storage. */
  storage: boolean
  /** PUT /disks/wipedisk declares no permissions: root@pam only. */
  wipe: boolean
}

export function useDiskPermissions(): DiskPermissions {
  const perms = usePermissions()
  const session = useSession()
  const modify = perms.can({ privs: 'Sys.Modify', path: '/' })
  return {
    modify,
    storage: perms.can({ privs: 'Datastore.Allocate', path: '/storage' }),
    wipe: session?.username === 'root@pam',
  }
}

const TONE_DOT: Record<HealthTone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  unknown: 'bg-muted-foreground/60',
}

export const TONE_TEXT: Record<HealthTone, string> = {
  ok: 'text-success-strong',
  warn: 'text-warning-strong',
  bad: 'text-destructive',
  unknown: 'text-muted-foreground',
}

/** Dot + label in the tone's colour ("OK", "ONLINE", "DEGRADED"). */
export function HealthBadge({ tone, children, className }: { tone: HealthTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', TONE_TEXT[tone], className)}>
      <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', TONE_DOT[tone])} />
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Small labelled value tile (detail sheets). */
export function Fact({ label, children, className, mono }: { label: string; children: ReactNode; className?: string; mono?: boolean }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-border/60 ring-inset paper:bg-secondary/50', className)}
    >
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-[13px] break-words', mono && 'font-mono text-xs break-all')}>{children}</div>
    </div>
  )
}

/** Title, count, refresh and "create" for one sub-view. */
export function ViewHeader({
  title,
  count,
  onRefresh,
  refreshing,
  createLabel,
  onCreate,
}: {
  title: string
  count?: number | undefined
  onRefresh: () => void
  refreshing?: boolean
  createLabel?: string
  onCreate?: (() => void) | undefined
}) {
  return (
    <div className="flex min-h-11 items-center gap-2">
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
        {title}
        {count !== undefined && <span className="ml-1.5 text-muted-foreground tabular">{count}</span>}
      </h2>
      <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="刷新" title="刷新" className="pointer-coarse:size-11">
        <RefreshCw className={cn(refreshing && 'animate-spin')} />
      </Button>
      {onCreate && (
        <Button onClick={onCreate} className="pointer-coarse:h-11">
          <Plus /> {createLabel ?? '创建'}
        </Button>
      )}
    </div>
  )
}

export function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="shrink-0 text-muted-foreground hover:text-destructive pointer-coarse:size-11"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <Trash2 />
    </Button>
  )
}

/** Numbers that line up (sizes, counts). */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('tabular', className)}>{children}</span>
}
