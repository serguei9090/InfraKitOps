import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { reportError } from '@/stores/errorStore'

interface Props {
  children: ReactNode
  /** When any value here changes, the boundary resets (e.g. route key). */
  resetKeys?: unknown[]
  /** Optional compact fallback for a sub-tree (default: full-screen card). */
  compact?: boolean
}
interface State {
  error: Error | null
  stack: string
}

/**
 * Catches render / lifecycle throws that `window.onerror` and the
 * unhandled-rejection handler cannot (OBSERVABILITY_PLAN O1). Without this a
 * component throw white-screens the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? '' })
    reportError(error, 'render')
  }

  componentDidUpdate(prev: Props) {
    if (!this.state.error) return
    const a = prev.resetKeys ?? []
    const b = this.props.resetKeys ?? []
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      this.setState({ error: null, stack: '' })
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    const dev = import.meta.env.DEV
    const body = (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-base font-semibold">Something broke on this screen</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          The error was logged. Reloading usually clears it.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => this.setState({ error: null, stack: '' })} variant="outline">
            Try again
          </Button>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
        {dev && (
          <pre className="mt-2 max-h-64 max-w-lg overflow-auto rounded-md border border-border/60 bg-card p-3 text-left font-mono text-[11px] text-destructive">
            {String(this.state.error?.stack ?? this.state.error)}
            {this.state.stack}
          </pre>
        )}
      </div>
    )

    return this.props.compact ? (
      <div className="rounded-lg border border-border/60 p-6">{body}</div>
    ) : (
      <div className="flex min-h-[60vh] items-center justify-center p-6">{body}</div>
    )
  }
}
