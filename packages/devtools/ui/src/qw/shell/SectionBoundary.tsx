/**
 * Section-scoped error + loading boundary.
 *
 * Wraps a slice of UI so that if a single section throws or suspends
 * (e.g. a KPI strip, a "Recent runs" card, the run detail right pane),
 * only that section degrades — the rest of the screen stays interactive.
 *
 * Pair with React.Suspense for loading and our ErrorBoundary class for
 * render-time crashes. The fallback UI is intentionally minimal so it
 * blends with surrounding cards.
 */

import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'

interface SectionErrorFallbackProps {
  /** Short human title — usually the section name ("Recent runs"). */
  title?: string
  error: Error
  onRetry: () => void
  compact?: boolean
}

export function SectionErrorFallback({ title = 'Section failed', error, onRetry, compact }: SectionErrorFallbackProps) {
  return (
    <div
      role="alert"
      className={
        compact
          ? 'flex items-start gap-2.5 rounded-[8px] px-3 py-2.5 text-[12px]'
          : 'flex items-start gap-3 rounded-[10px] px-4 py-3.5 text-[12.5px]'
      }
      style={{
        background: 'var(--qw-danger-soft)',
        border: '1px dashed var(--qw-danger)',
        color: 'var(--qw-fg)',
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold" style={{ color: 'var(--qw-danger)' }}>
          {title}
        </div>
        <div
          className="mt-0.5 truncate font-mono text-[11px]"
          style={{ color: 'var(--qw-fg-muted)' }}
          title={error.stack ?? error.message}
        >
          {error.name}: {error.message}
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-[5px] px-2 py-[3px] font-mono text-[11px]"
        style={{
          background: 'var(--qw-bg)',
          color: 'var(--qw-fg)',
          border: '1px solid var(--qw-border)',
        }}
      >
        Retry
      </button>
    </div>
  )
}

interface SectionErrorBoundaryProps {
  children: ReactNode
  title?: string
  compact?: boolean
  /** Bumping this resets the boundary back to render the children. */
  resetKey?: unknown
  /** Optional callback fired when the user clicks Retry. Use it to
   *  invalidate the queries the failing children depend on so the next
   *  render actually re-fetches instead of immediately re-throwing the
   *  cached error. */
  onRetry?: () => void
  /** Render-prop for the failure mode. Use this when the default
   *  dashed-card fallback would break the surrounding layout (e.g. a
   *  table row that has to keep its grid columns). The renderer
   *  receives the caught error and a `reset` callback that, when
   *  invoked, calls `onRetry()` and clears the boundary so children
   *  render again on the next render pass. */
  renderFallback?: (args: { error: Error; reset: () => void }) => ReactNode
}

interface State {
  error: Error | null
}

export class SectionErrorBoundary extends Component<SectionErrorBoundaryProps, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the console signal — these are scoped boundaries so we still
    // want a trace when they catch.
    // eslint-disable-next-line no-console
    console.error(`[Section "${this.props.title ?? 'unknown'}" crashed]`, error, info)
  }

  componentDidUpdate(prev: SectionErrorBoundaryProps) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      const reset = () => {
        // Fire the caller's invalidate callback BEFORE clearing the
        // boundary so the next render finds a fetching query (and
        // suspends or shows skeleton) instead of immediately
        // re-throwing the cached failure.
        this.props.onRetry?.()
        this.setState({ error: null })
      }
      if (this.props.renderFallback) {
        return this.props.renderFallback({ error: this.state.error, reset })
      }
      return (
        <SectionErrorFallback
          title={this.props.title}
          error={this.state.error}
          onRetry={reset}
          compact={this.props.compact}
        />
      )
    }
    return this.props.children
  }
}

/**
 * Per-row error boundary tailored for table layouts.
 *
 * Renders a single inline danger row preserving the row's grid
 * footprint (so adjacent rows don't shift). A click on the row resets
 * the boundary, which is the most a viewer can usefully do — the
 * data shape is what's broken, not the network.
 *
 *   <RowErrorBoundary rowKey={run.traceId}>
 *     <ExpensiveRunRow run={run} />
 *   </RowErrorBoundary>
 */
export function RowErrorBoundary({
  children,
  rowKey,
}: {
  children: ReactNode
  /** Stable identifier for the row — used as the reset key so the
   *  boundary clears when the user scrolls past and the row mounts
   *  fresh with new data. */
  rowKey: string
}) {
  return (
    <SectionErrorBoundary
      resetKey={rowKey}
      renderFallback={({ error, reset }) => (
        <button
          type="button"
          onClick={reset}
          className="flex w-full items-center gap-2 px-8 py-2 text-left text-[12px] hover:opacity-90"
          style={{
            background: 'var(--qw-danger-soft)',
            color: 'var(--qw-danger)',
            borderBottom: '1px solid var(--qw-border)',
          }}
          title={error.stack ?? error.message}
        >
          <span
            aria-hidden
            className="inline-block size-[6px] shrink-0 rounded-full"
            style={{ background: 'var(--qw-danger)' }}
          />
          <span className="truncate font-medium">Row failed to render</span>
          <span className="ml-1 truncate font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {error.name}: {error.message}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
            click to retry
          </span>
        </button>
      )}
    >
      {children}
    </SectionErrorBoundary>
  )
}

/**
 * One-stop wrapper: ErrorBoundary + Suspense + skeleton fallback.
 * Use this around any section you want to fail / suspend independently.
 *
 *   <SectionBoundary title="Recent runs" fallback={<SkeletonRows rows={6} />}>
 *     <RecentRunsCard />
 *   </SectionBoundary>
 *
 * Pass `invalidateKeys` so the Retry button actually re-fetches the
 * data the failing section depended on, instead of just bouncing the
 * boundary back to a cached error:
 *
 *   <SectionBoundary
 *     title="Run detail"
 *     invalidateKeys={[qk.quality.run(traceId)]}
 *     fallback={<RunDetailSkeleton mode="inspect" />}
 *   >…</SectionBoundary>
 */
export function SectionBoundary({
  children,
  title,
  fallback = null,
  compact,
  resetKey,
  invalidateKeys,
  onRetry,
}: {
  children: ReactNode
  title?: string
  fallback?: ReactNode
  compact?: boolean
  resetKey?: unknown
  /** Query keys to invalidate when the user clicks Retry. */
  invalidateKeys?: readonly QueryKey[]
  /** Extra callback fired alongside the cache invalidation. */
  onRetry?: () => void
}) {
  const client = useQueryClient()
  const handleRetry =
    invalidateKeys?.length || onRetry
      ? () => {
          for (const key of invalidateKeys ?? []) {
            void client.invalidateQueries({ queryKey: key })
          }
          onRetry?.()
        }
      : undefined
  return (
    <SectionErrorBoundary title={title} compact={compact} resetKey={resetKey} onRetry={handleRetry}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </SectionErrorBoundary>
  )
}
