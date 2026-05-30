/**
 * SpanManager — abstraction over OTel Tracer and lightweight TraceSpan tracking.
 *
 * Provides a unified API for creating, annotating, and ending spans regardless
 * of whether the user is using the standard OTel path or a lightweight exporter.
 *
 * @module
 */

import type { TraceSpan, SpanStatus } from './types'
import type { SpanExporter } from './exporter'

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
  attributes: Record<string, string | number | boolean>
  status: SpanStatus
  events: Array<{
    name: string
    time: number
    attributes?: Record<string, string | number | boolean>
  }>
}

/** Handle to an active span. */
export interface SpanRef {
  /** The span ID. */
  readonly spanId: string
  /** The trace ID. */
  readonly traceId: string
}

/** Span manager for creating and managing spans. */
export interface SpanManager {
  /**
   * Start a new span.
   *
   * @param name - Span name (e.g., 'crux.generate').
   * @param attributes - Initial attributes.
   * @param parentSpanId - Parent span ID for nesting.
   * @returns A reference to the active span.
   */
  startSpan(name: string, attributes?: Record<string, string | number | boolean>, parentSpanId?: string): SpanRef

  /** Set attributes on an active span. */
  setAttributes(ref: SpanRef, attributes: Record<string, string | number | boolean>): void

  /** Set the span status. */
  setStatus(ref: SpanRef, status: SpanStatus): void

  /** Record an error on the span and set status to ERROR. */
  recordError(ref: SpanRef, error: Error | string): void

  /** Add a point-in-time event to the span. */
  addEvent(ref: SpanRef, name: string, attributes?: Record<string, string | number | boolean>): void

  /** End the span and export it. */
  endSpan(ref: SpanRef): void

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
  const activeSpans = new Map<string, MutableSpan>()

  return {
    startSpan(name, attributes, parentSpanId) {
      const spanId = generateId()
      const traceId = parentSpanId ? (activeSpans.get(parentSpanId)?.traceId ?? generateId()) : generateId()

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
      const span = activeSpans.get(ref.spanId)
      if (!span) return

      activeSpans.delete(ref.spanId)

      const endTime = Date.now()
      const traceSpan: TraceSpan = {
        spanId: span.spanId,
        traceId: span.traceId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        startTime: span.startTime,
        endTime,
        durationMs: endTime - span.startTime,
        attributes: span.attributes,
        status: span.status.code === 'UNSET' ? { code: 'OK' } : span.status,
        events: span.events.length > 0 ? span.events : undefined,
      }

      // Fire-and-forget
      exporter.export([traceSpan])
    },

    async shutdown() {
      activeSpans.clear()
      await exporter.shutdown()
    },
  }
}
