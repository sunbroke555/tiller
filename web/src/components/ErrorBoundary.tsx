import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

import { EmptyState } from './EmptyState'
import { GlassCard } from './GlassCard'
import { Button } from './ui/button'

interface Props {
  children: ReactNode
  /** Custom fallback; receives the error and a reset function. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

/** A new deployment replaced the lazy chunk this page needs (the old one is gone). */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically imported module/i.test(
    message,
  )
}

/**
 * The error card shared by ErrorBoundary and the route error element: a
 * missing chunk asks to reload; anything else shows the message and `onRetry`
 * (default: reload the page).
 */
export function ErrorFallback({ error, onRetry, extraAction }: { error: unknown; onRetry?: () => void; extraAction?: ReactNode }) {
  const chunk = isChunkLoadError(error)
  const message = error instanceof Error ? error.message : String(error ?? '')
  const reload = () => window.location.reload()
  return (
    <GlassCard>
      <EmptyState
        icon={TriangleAlert}
        title={chunk ? '页面已更新' : '这部分界面出错了'}
        description={chunk ? '应用有新版本，刷新后即可继续。' : message || '发生未知错误'}
        action={
          <span className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={chunk ? reload : (onRetry ?? reload)}>
              {chunk ? '刷新页面' : '重试'}
            </Button>
            {extraAction}
          </span>
        }
      />
    </GlassCard>
  )
}

/**
 * Keeps a crash in one tab or panel from taking down the page. Pass `key`
 * (e.g. the tab id) to reset it on navigation.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return <ErrorFallback error={error} onRetry={this.reset} />
  }
}
