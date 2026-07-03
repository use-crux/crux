/**
 * Coalesces streaming token text into bounded observability chunk events.
 *
 * Provider streams often deliver very small text deltas. Emitting one graph
 * record per provider delta makes local storage, websocket fan-out, and run
 * detail reads scale with token count. The coalescer keeps the public stream
 * unchanged while reducing observability traffic to timed/text-size chunks.
 *
 * @module
 * @internal
 */

import type { CruxAttributes } from '../observability/contract'

const DEFAULT_TOKEN_CHUNK_FLUSH_MS = 80
const DEFAULT_TOKEN_CHUNK_MAX_CHARS = 512

/** Attributes emitted on each canonical `token.chunk` span event. */
export interface StreamTokenChunkAttributes extends CruxAttributes {
  /** Merged token text for this observability chunk. */
  readonly text: string
  /** Zero-based index of this coalesced chunk within the stream span. */
  readonly chunkIndex: number
  /** Number of UTF-16 code units in {@link text}. */
  readonly charCount: number
  /** ISO timestamp for the first provider delta included in this chunk. */
  readonly firstDeltaAt: string
  /** ISO timestamp for the last provider delta included in this chunk. */
  readonly lastDeltaAt: string
}

/** Observability sink for a coalesced token chunk. */
export type StreamTokenChunkEmitter = (attributes: StreamTokenChunkAttributes) => void

export interface StreamTokenCoalescer {
  /** Add one provider text delta and flush immediately if the size cap is met. */
  add(delta: string): void
  /** Flush any buffered text and cancel the pending timer. */
  flush(): void
  /** Provider delta count observed so far. */
  deltaCount(): number
  /** Coalesced chunk count emitted so far. */
  chunkCount(): number
}

interface StreamTokenCoalescerOptions {
  readonly emit: StreamTokenChunkEmitter
  readonly flushIntervalMs?: number
  readonly maxChars?: number
  readonly now?: () => Date
}

/**
 * Create a stream token coalescer.
 *
 * The returned object is intentionally synchronous: stream iteration already
 * runs inside the generation span context, and `observe.event()` is fail-open.
 */
export function createStreamTokenCoalescer(options: StreamTokenCoalescerOptions): StreamTokenCoalescer {
  const flushIntervalMs = positiveIntegerOrDefault(options.flushIntervalMs, DEFAULT_TOKEN_CHUNK_FLUSH_MS)
  const maxChars = positiveIntegerOrDefault(options.maxChars, DEFAULT_TOKEN_CHUNK_MAX_CHARS)
  const now = options.now ?? (() => new Date())
  const buffer: string[] = []
  let bufferedChars = 0
  let chunkIndex = 0
  let deltas = 0
  let firstDeltaAt: string | undefined
  let lastDeltaAt: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const clearFlushTimer = (): void => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  const scheduleFlush = (): void => {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      flush()
    }, flushIntervalMs)
    unrefTimer(timer)
  }

  const flush = (): void => {
    if (bufferedChars === 0) {
      clearFlushTimer()
      return
    }
    clearFlushTimer()
    const text = buffer.join('')
    const emittedFirstDeltaAt = firstDeltaAt ?? now().toISOString()
    const emittedLastDeltaAt = lastDeltaAt ?? emittedFirstDeltaAt
    buffer.length = 0
    bufferedChars = 0
    firstDeltaAt = undefined
    lastDeltaAt = undefined
    options.emit({
      text,
      chunkIndex,
      charCount: text.length,
      firstDeltaAt: emittedFirstDeltaAt,
      lastDeltaAt: emittedLastDeltaAt,
    })
    chunkIndex += 1
  }

  return {
    add(delta: string): void {
      if (delta.length === 0) return
      const observedAt = now().toISOString()
      firstDeltaAt ??= observedAt
      lastDeltaAt = observedAt
      buffer.push(delta)
      bufferedChars += delta.length
      deltas += 1
      if (bufferedChars >= maxChars) {
        flush()
        return
      }
      scheduleFlush()
    },
    flush,
    deltaCount(): number {
      return deltas
    },
    chunkCount(): number {
      return chunkIndex
    },
  }
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeUnref = (timer as { unref?: unknown }).unref
  if (typeof maybeUnref === 'function') {
    maybeUnref.call(timer)
  }
}
