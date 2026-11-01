import type { ReactNode } from 'react'
import { RefreshCw, ShieldOff, TriangleAlert, WifiOff, type LucideIcon } from 'lucide-react'

import { isPveApiError } from '@/api/client'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { EmptyState } from './EmptyState'
import { GlassCard } from './GlassCard'
import { Button } from './ui/button'
import { Skeleton } from './ui/skeleton'

export type ErrorKind = 'offline' | 'forbidden' | 'missing' | 'error'

/** Classify a failed request for a consistent error screen. */
export function errorKind(error: unknown): ErrorKind {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  if (isPveApiError(error)) {
    if (error.isNetworkError || error.status === 502 || error.status === 503 || error.status === 504) return 'offline'
    if (error.status === 403) return 'forbidden'
    if (error.status === 404) return 'missing'
  }
  return 'error'
}

const KIND: Record<ErrorKind, { icon: LucideIcon; title: string; hint?: string }> = {
  offline: { icon: WifiOff, title: '无法连接服务器', hint: '请检查网络或 PVE 是否在线，恢复后会自动重试。' },
  forbidden: { icon: ShieldOff, title: '没有权限', hint: '当前账户没有查看这部分内容的权限，请联系管理员。' },
  missing: { icon: TriangleAlert, title: '找不到内容' },
  error: { icon: TriangleAlert, title: '加载失败' },
}

interface ErrorStateProps {
  error: unknown
  onRetry?: () => void
  /** Overrides the title derived from the error. */
  title?: ReactNode
  /** Smaller padding, for errors inside a card section. */
  compact?: boolean
  className?: string
}

/** Error body for a failed query: offline / no permission / generic, with a retry button. */
export function ErrorState({ error, onRetry, title, compact, className }: ErrorStateProps) {
  const kind = errorKind(error)
  const meta = KIND[kind]
  const detail = errorMessage(error)
  return (
    <EmptyState
      icon={meta.icon}
      title={title ?? meta.title}
      description={
        <>
          {meta.hint && <span className="block">{meta.hint}</span>}
          {kind !== 'offline' && detail && <span className="mt-1 block text-xs break-words text-faint">{detail}</span>}
        </>
      }
      action={
        onRetry && (
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw /> 重试
          </Button>
        )
      }
      className={cn(compact && 'py-8', className)}
    />
  )
}

/** ErrorState on its own card (page-level failures). */
export function ErrorCard(props: ErrorStateProps) {
  return (
    <GlassCard>
      <ErrorState {...props} />
    </GlassCard>
  )
}

/** Skeleton rows matching list rows (status dot, two lines, value on the right). */
export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('divide-y divide-border/70', className)} aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-(--card-p) py-4">
          <Skeleton className="size-2 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-[60%]" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  )
}

/** Skeleton cards for a grid of cards. */
export function LoadingCards({ count = 3, className, cardClassName }: { count?: number; className?: string; cardClassName?: string }) {
  return (
    <div className={cn('grid gap-(--row-gap) sm:grid-cols-2 xl:grid-cols-3', className)} aria-busy="true" aria-label="加载中">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn('h-36 rounded-2xl', cardClassName)} />
      ))}
    </div>
  )
}
