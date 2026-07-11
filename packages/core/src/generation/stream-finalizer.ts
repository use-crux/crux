/**
 * Single-owner finalization for observed stream spans.
 *
 * Stream orchestration has two independent completion signals: raw stream
 * consumption and provider completion metadata. Only the raw stream signal
 * (or, when there is no raw stream to observe, provider completion) is
 * terminal: the span ends exactly once, immediately, with whatever metrics
 * are known at that moment. Provider completion metadata that is still
 * observed after that (or that never observes a raw stream at all) is
 * attached as linked telemetry by the caller; this module never reopens or
 * mutates an already-ended span's duration/status.
 *
 * @module
 * @internal
 */

import type { observe } from '../observability'
import type { GenerationPerformanceTracker } from './performance-metrics'

type ObservedSpan = ReturnType<typeof observe.openSpan>

export interface StreamSpanFinalizerOptions {
  readonly span: ObservedSpan
  readonly performance: GenerationPerformanceTracker
  readonly expectsStream: boolean
  readonly expectsCompletion: boolean
}

export interface StreamEndOptions {
  readonly tokenChunkCount: number
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
 * Create a finalizer that closes a stream span exactly once, on the actual
 * stream terminal signal, never on a timer.
 *
 * When a raw stream is observed, only that stream's own terminal signal
 * (drain, early return, or throw) ends the span. Provider completion is
 * then late, linked metadata handled by the caller and must never reopen the
 * span. When no raw stream is observed, provider completion is itself the
 * terminal signal.
 */
export function createStreamSpanFinalizer(
  options: StreamSpanFinalizerOptions,
): StreamSpanFinalizer {
  let finalized = false
  let streamCompleted = !options.expectsStream
  let streamTokenChunkCount = 0

  const commonAttributes = (reason?: string) => ({
    streamCompleted,
    tokenChunkCount: streamTokenChunkCount,
    ...(reason ? { streamFinalizedReason: reason } : {}),
  })

  const finalize = (
    reason: string | undefined,
    status: 'ok' | 'error' | 'cancelled',
    meta: Record<string, unknown> | undefined,
    error?: unknown,
  ): void => {
    if (finalized) return
    finalized = true
    options.span.end({
      status,
      metrics: options.performance.metrics(meta),
      ...(error !== undefined ? { error } : {}),
      attributes: commonAttributes(reason),
    })
  }

  return {
    streamEnded({ tokenChunkCount }) {
      if (finalized) return
      streamCompleted = true
      streamTokenChunkCount = tokenChunkCount
      finalize('stream-end', 'ok', undefined)
    },
    streamReturned({ tokenChunkCount }) {
      if (finalized) return
      streamCompleted = false
      streamTokenChunkCount = tokenChunkCount
      finalize('return', 'cancelled', undefined)
    },
    streamErrored({ tokenChunkCount, error }) {
      if (finalized) return
      streamCompleted = false
      streamTokenChunkCount = tokenChunkCount
      finalize('throw', 'error', undefined, error)
    },
    completionSettled({ meta }) {
      // A raw stream, when observed, is the sole terminal signal. Completion
      // arriving here is late/linked metadata handled by the caller, not a
      // reason to end (or re-end) the span.
      if (options.expectsStream) return
      streamCompleted = true
      finalize(undefined, 'ok', meta)
    },
    completionErrored(error) {
      if (options.expectsStream) return
      finalize('completion-error', 'error', undefined, error)
    },
  }
}
