/**
 * Per-screen error boundary so a thrown render doesn't blank the
 * whole devtools app. Shows the error + stack so we can diagnose
 * without opening DevTools, and a "Retry" / "Go to Overview" hatch.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  resetKey?: string
  onReset?: () => void
}

interface State {
  error: Error | null
  info: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info })
    console.error('[QwShell] Screen crashed:', error, info)
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, info: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        className="flex h-full items-start justify-center overflow-auto p-10"
        style={{ background: 'var(--qw-bg)', color: 'var(--qw-fg)' }}
      >
        <div
          className="w-full max-w-[720px] rounded-[10px] p-6"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        >
          <div
            className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em]"
            style={{ color: 'var(--qw-danger)' }}
          >
            Screen crashed
          </div>
          <h2 className="m-0 mb-2 text-[20px] font-semibold tracking-[-0.01em]">
            {this.state.error.name}: {this.state.error.message}
          </h2>
          <p className="m-0 mb-4 text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
            One of the legacy view components threw. The rest of the workbench is still functional.
          </p>
          <pre
            className="m-0 max-h-[320px] overflow-auto rounded-[6px] px-3 py-2.5 font-mono text-[11px] leading-[1.5]"
            style={{
              background: 'var(--qw-bg-muted)',
              border: '1px solid var(--qw-border)',
              color: 'var(--qw-fg-muted)',
            }}
          >
            {this.state.error.stack ?? this.state.error.message}
          </pre>
          {this.state.info?.componentStack && (
            <pre
              className="mt-2 max-h-[200px] overflow-auto rounded-[6px] px-3 py-2.5 font-mono text-[10.5px] leading-[1.5]"
              style={{
                background: 'var(--qw-bg-muted)',
                border: '1px solid var(--qw-border)',
                color: 'var(--qw-fg-faint)',
              }}
            >
              {this.state.info.componentStack}
            </pre>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null, info: null })
                this.props.onReset?.()
              }}
              className="rounded-[6px] px-3 py-1.5 text-[12px] font-medium"
              style={{
                background: 'var(--qw-crux)',
                color: 'var(--qw-bg)',
              }}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/'
              }}
              className="rounded-[6px] px-3 py-1.5 text-[12px] font-medium"
              style={{
                background: 'transparent',
                color: 'var(--qw-fg)',
                boxShadow: 'inset 0 0 0 1px var(--qw-border)',
              }}
            >
              Go to Overview
            </button>
          </div>
        </div>
      </div>
    )
  }
}
