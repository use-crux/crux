/**
 * Single-owner finalization for observed stream spans.
 *
 * Stream orchestration has two independent completion signals: raw stream
 * consumption and provider completion metadata. This helper keeps the public
 * span lifecycle boring: one `span.end()` call, with provider metadata merged
 * into the final metrics whenever it arrives before the grace timeout.
 *
 * @module
 * @internal
 */

import type { observe } from '../observability'
import type { GenerationPerformanceTracker } from './performance-metrics'

type ObservedSpan = ReturnType<typeof observe.openSpan>

const completionGraceMs = 10_000

export interface StreamSpanFinalizerOptions {
  readonly span: ObservedSpan
  readonly performance: GenerationPerformanceTracker
  readonly expectsStream: boolean
  readonly expectsCompletion: boolean
}

export interface StreamEndOptions {
  readonly tokenDeltaCount: number
}

export interface StreamAbortOptions extends StreamEndOptions {
  readonly error?: unknown
}

export interface StreamCompletionOptions {
  readonly meta?: Record<string, unknown>
}

export interface StreamSpanFinalizer {
  readonly streamEnded: (options: StreamEndOptions) => void
  readonly streamReturned: (options: StreamEndOptions) => void
  readonly streamErrored: (options: StreamAbortOptions) => void
  readonly completionSettled: (options: StreamCompletionOptions) => void
  readonly completionErrored: (error: unknown) => void
}

/**
 * Create a finalizer that closes a stream span exactly once.
 *
 * The first successful signal waits for the other expected signal. Stream
 * abandonment and errors are terminal immediately because the provider metadata
 * can no longer make the stream complete successfully.
 */
export function createStreamSpanFinalizer(options: StreamSpanFinalizerOptions): StreamSpanFinalizer {
  let streamReported = !options.expectsStream
  let completionReported = !options.expectsCompletion
  let completionMeta: Record<string, unknown> | undefined
  let streamTokenDeltaCount = 0
  let streamCompleted = !options.expectsStream
  let finalized = false
  let graceTimer: ReturnType<typeof setTimeout> | undefined

  const clearGraceTimer = (): void => {
    if (graceTimer === undefined) return
    clearTimeout(graceTimer)
    graceTimer = undefined
  }

  const scheduleGraceTimer = (): void => {
    if (!options.expectsCompletion || completionReported || graceTimer !== undefined || finalized) return
    graceTimer = setTimeout(() => {
      completionReported = true
      finalize('timeout', 'ok')
    }, completionGraceMs)
    graceTimer.unref?.()
  }

  const commonAttributes = (reason?: string) => ({
    streamCompleted,
    tokenDeltaCount: streamTokenDeltaCount,
    ...(reason ? { streamFinalizedReason: reason } : {}),
  })

  const maybeFinalize = (): void => {
    if (streamReported && completionReported) finalize(undefined, 'ok')
  }

  const finalize = (
    reason: string | undefined,
    status: 'ok' | 'error' | 'cancelled',
    error?: unknown,
  ): void => {
    if (finalized) return
    finalized = true
    clearGraceTimer()
    options.span.end({
      status,
      metrics: options.performance.metrics(completionMeta),
      ...(error !== undefined ? { error } : {}),
      attributes: commonAttributes(reason),
    })
  }

  return {
    streamEnded({ tokenDeltaCount }) {
      if (finalized) return
      streamReported = true
      streamCompleted = true
      streamTokenDeltaCount = tokenDeltaCount
      if (!completionReported) {
        scheduleGraceTimer()
        return
      }
      maybeFinalize()
    },
    streamReturned({ tokenDeltaCount }) {
      if (finalized) return
      streamReported = true
      streamCompleted = false
      streamTokenDeltaCount = tokenDeltaCount
      finalize('return', 'cancelled')
    },
    streamErrored({ tokenDeltaCount, error }) {
      if (finalized) return
      streamReported = true
      streamCompleted = false
      streamTokenDeltaCount = tokenDeltaCount
      finalize('throw', 'error', error)
    },
    completionSettled({ meta }) {
      if (finalized) return
      completionReported = true
      completionMeta = meta
      maybeFinalize()
    },
    completionErrored(error) {
      if (finalized) return
      completionReported = true
      finalize('completion-error', 'error', error)
    },
  }
}
