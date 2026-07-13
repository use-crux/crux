/**
 * SpanManager — abstraction over OTel Tracer and lightweight TraceSpan tracking.
 *
 * Provides a unified API for creating, annotating, and ending spans regardless
 * of whether the user is using the standard OTel path or a lightweight exporter.
 *
 * @module
 */

import type { TraceAttributeValue, TraceSpan, SpanStatus } from './types'
import type { SpanExporter } from './exporter'
import { createBoundedRegistry } from './bounded-registry'

let spanCounter = 0

function generateId(): string {
  spanCounter++
  return `${Date.now()}-${spanCounter}-${Math.random().toString(36).slice(2, 8)}`
}

/** A mutable span being built. */
interface MutableSpan {
  spanId: string
  traceId: string
  parentSpanId?: string
  name: string
  startTime: number
  attributes: Record<string, TraceAttributeValue>
  status: SpanStatus
  events: Array<{
    name: string
    time: number
    attributes?: Record<string, TraceAttributeValue>
  }>
}

const ACTIVE_SPAN_MAX_ENTRIES = 10_000
const ACTIVE_SPAN_MAX_AGE_MS = 10 * 60_000

/** Handle to an active span. */
export interface SpanRef {
  /** The span ID. */
  readonly spanId: string
  /** The trace ID. */
  readonly traceId: string
}

/** Preferred W3C identifiers from the upstream Crux graph record. */
export interface SpanIdentity {
  /** W3C span ID to use when the manager owns span identity. */
  readonly spanId?: string
  /** W3C trace ID to use when the manager owns trace identity. */
  readonly traceId?: string
}

/** Span manager for creating and managing spans. */
export interface SpanManager {
  /**
   * Start a new span.
   *
   * @param name - Span name (e.g., 'chat gpt-4o').
   * @param attributes - Initial attributes.
   * @param parentSpanId - Parent span ID for nesting.
   * @returns A reference to the active span.
   */
  startSpan(
    name: string,
    attributes?: Record<string, TraceAttributeValue>,
    parentSpanId?: string,
    identity?: SpanIdentity,
  ): SpanRef

  /** Set attributes on an active span. */
  setAttributes(ref: SpanRef, attributes: Record<string, TraceAttributeValue>): void

  /** Set the span status. */
  setStatus(ref: SpanRef, status: SpanStatus): void

  /** Record an error on the span and set status to ERROR. */
  recordError(ref: SpanRef, error: Error | string): void

  /** Add a point-in-time event to the span. */
  addEvent(ref: SpanRef, name: string, attributes?: Record<string, TraceAttributeValue>): void

  /** End the span and export it. */
  endSpan(ref: SpanRef): void

  /**
   * Run `fn` with this span activated as the real execution context (e.g. the
   * OTel active span), so nested user/provider spans parent correctly and
   * `trace.getActiveSpan()` resolves inside `fn`.
   *
   * Lightweight managers have no ambient execution context to activate and
   * simply invoke `fn` unchanged.
   */
  runActive<T>(ref: SpanRef, fn: () => T): T

  /**
   * Force-end a span evicted from bounded telemetry registries.
   *
   * Expired spans are exported with `crux.expired: true` and `UNSET` status so
   * collectors can distinguish registry pressure from successful work.
   */
  expireSpan(ref: SpanRef): void

  /**
   * Wait for queued exporter/processor work to settle, bounded by an optional
   * deadline.
   *
   * Never throws: exporter failures are absorbed so telemetry cannot break
   * application work. `timedOut` distinguishes "flushed everything" from
   * "gave up at the deadline" for callers that report exporter health.
   */
  forceFlush(options?: SpanManagerFlushOptions): Promise<SpanManagerFlushResult>

  /** Shut down the span manager. Internally force-flushes with a bounded budget first. */
  shutdown(): Promise<void>
}

/** Bounds for {@link SpanManager.forceFlush}. */
export interface SpanManagerFlushOptions {
  /** Milliseconds to wait for outstanding exports before giving up. Omit to wait unbounded. */
  readonly deadlineMs?: number
}

/** Structured result of a bounded flush. */
export interface SpanManagerFlushResult {
  /** Exporter/processor units that settled before the deadline (or before flush was called, if already idle). */
  readonly flushed: number
  /** Units still outstanding when the deadline was reached. */
  readonly pending: number
  /** Whether the deadline was reached before everything settled. */
  readonly timedOut: boolean
}

/**
 * Create a lightweight span manager that tracks spans internally
 * and exports them via the provided exporter.
 *
 * @param exporter - Where to send completed spans.
 * @returns A `SpanManager` backed by internal tracking.
 */
export function createLightweightSpanManager(exporter: SpanExporter): SpanManager {
  const activeSpans = createBoundedRegistry<string, MutableSpan>({
    maxEntries: ACTIVE_SPAN_MAX_ENTRIES,
    maxAgeMs: ACTIVE_SPAN_MAX_AGE_MS,
    onEvict: (_spanId, span) => {
      exportSpan(exporter, span, { expired: true, preserveUnsetStatus: true }, pendingExports)
    },
  })
  const pendingExports = new Set<Promise<unknown>>()

  return {
    startSpan(name, attributes, parentSpanId, identity) {
      const parent = parentSpanId ? activeSpans.get(parentSpanId) : undefined
      const spanId = identity?.spanId ?? generateId()
      const traceId = identity?.traceId ?? parent?.traceId ?? generateId()

      const span: MutableSpan = {
        spanId,
        traceId,
        parentSpanId,
        name,
        startTime: Date.now(),
        attributes: { ...attributes },
        status: { code: 'UNSET' },
        events: [],
      }

      activeSpans.set(spanId, span)
      return { spanId, traceId }
    },

    setAttributes(ref, attributes) {
      const span = activeSpans.get(ref.spanId)
      if (span) {
        Object.assign(span.attributes, attributes)
      }
    },

    setStatus(ref, status) {
      const span = activeSpans.get(ref.spanId)
      if (span) {
        span.status = status
      }
    },

    recordError(ref, error) {
      const span = activeSpans.get(ref.spanId)
      if (span) {
        span.status = {
          code: 'ERROR',
          message: typeof error === 'string' ? error : error.message,
        }
        span.events.push({
          name: 'exception',
          time: Date.now(),
          attributes: {
            'exception.message': typeof error === 'string' ? error : error.message,
            ...(error instanceof Error && error.stack ? { 'exception.stacktrace': error.stack } : {}),
          },
        })
      }
    },

    addEvent(ref, name, attributes) {
      const span = activeSpans.get(ref.spanId)
      if (span) {
        span.events.push({ name, time: Date.now(), attributes })
      }
    },

    endSpan(ref) {
      const span = activeSpans.delete(ref.spanId)
      if (!span) return

      exportSpan(exporter, span, { expired: false, preserveUnsetStatus: false }, pendingExports)
    },

    runActive<T>(_ref: SpanRef, fn: () => T): T {
      return fn()
    },

    expireSpan(ref) {
      const span = activeSpans.delete(ref.spanId)
      if (!span) return
      exportSpan(exporter, span, { expired: true, preserveUnsetStatus: true }, pendingExports)
    },

    async forceFlush(options) {
      return await flushPendingExports(pendingExports, options)
    },

    async shutdown() {
      await flushPendingExports(pendingExports, { deadlineMs: SHUTDOWN_FLUSH_DEADLINE_MS })
      activeSpans.clear()
      await exporter.shutdown()
    },
  }
}

const SHUTDOWN_FLUSH_DEADLINE_MS = 5_000

/** Await outstanding export promises, bounded by an optional deadline. Never throws. */
async function flushPendingExports(
  pending: ReadonlySet<Promise<unknown>>,
  options?: SpanManagerFlushOptions,
): Promise<SpanManagerFlushResult> {
  const total = pending.size
  if (total === 0) return { flushed: 0, pending: 0, timedOut: false }

  const settleAll = Promise.allSettled([...pending]).then(() => false)
  const deadlineMs = options?.deadlineMs
  const timedOut = deadlineMs === undefined ? await settleAll : await raceDeadline(settleAll, deadlineMs)
  const remaining = pending.size
  return { flushed: total - remaining, pending: remaining, timedOut }
}

async function raceDeadline(settleAll: Promise<boolean>, deadlineMs: number): Promise<boolean> {
  return await Promise.race([
    settleAll,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), Math.max(0, deadlineMs))),
  ])
}

function exportSpan(
  exporter: SpanExporter,
  span: MutableSpan,
  options: { readonly expired: boolean; readonly preserveUnsetStatus: boolean },
  pendingExports: Set<Promise<unknown>>,
): void {
  const endTime = Date.now()
  const attributes = options.expired ? { ...span.attributes, 'crux.expired': true } : span.attributes
  const traceSpan: TraceSpan = {
    spanId: span.spanId,
    traceId: span.traceId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    startTime: span.startTime,
    endTime,
    durationMs: endTime - span.startTime,
    attributes,
    status: span.status.code === 'UNSET' && !options.preserveUnsetStatus ? { code: 'OK' } : span.status,
    events: span.events.length > 0 ? span.events : undefined,
  }

  const exported = Promise.resolve(exporter.export([traceSpan])).catch(() => {})
  pendingExports.add(exported)
  void exported.finally(() => pendingExports.delete(exported))
}
