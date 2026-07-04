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
   * Force-end a span evicted from bounded telemetry registries.
   *
   * Expired spans are exported with `crux.expired: true` and `UNSET` status so
   * collectors can distinguish registry pressure from successful work.
   */
  expireSpan(ref: SpanRef): void

  /** Shut down the span manager and flush any pending exports. */
  shutdown(): Promise<void>
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
      exportSpan(exporter, span, { expired: true, preserveUnsetStatus: true })
    },
  })

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

      exportSpan(exporter, span, { expired: false, preserveUnsetStatus: false })
    },

    expireSpan(ref) {
      const span = activeSpans.delete(ref.spanId)
      if (!span) return
      exportSpan(exporter, span, { expired: true, preserveUnsetStatus: true })
    },

    async shutdown() {
      activeSpans.clear()
      await exporter.shutdown()
    },
  }
}

function exportSpan(
  exporter: SpanExporter,
  span: MutableSpan,
  options: { readonly expired: boolean; readonly preserveUnsetStatus: boolean },
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

  // Fire-and-forget.
  exporter.export([traceSpan])
}
