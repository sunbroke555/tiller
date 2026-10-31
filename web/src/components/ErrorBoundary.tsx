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
    // A new deployment replaced the lazy chunk this page needs.
    const chunk = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message)
    return (
      <GlassCard>
        <EmptyState
          icon={TriangleAlert}
          title={chunk ? '页面已更新' : '这部分界面出错了'}
          description={chunk ? '应用有新版本，刷新后即可继续。' : error.message}
          action={
            <Button variant="outline" onClick={chunk ? () => window.location.reload() : this.reset}>
              {chunk ? '刷新页面' : '重试'}
            </Button>
          }
        />
      </GlassCard>
    )
  }
}
