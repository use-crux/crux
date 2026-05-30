/**
 * Context bridge for linking Crux trace context to OTel spans.
 *
 * Maintains a map of active spans keyed by Crux identifiers (traceId,
 * flowId, compositionId) so instrumentation hooks can find the correct
 * parent span even when firing outside the original async context.
 *
 * @module
 */

/**
 * Opaque span handle — either an OTel Span or a lightweight TraceSpan reference.
 * The SpanManager knows how to end/annotate it.
 */
export type SpanHandle = unknown

/**
 * Active span registry.
 *
 * Maps Crux identifiers to span handles for parent-child linking.
 * Entries are added when spans start and removed when they end.
 */
export interface ActiveSpanMap {
  /** Store a span handle keyed by identifier. */
  set(key: string, span: SpanHandle): void
  /** Retrieve a span handle by identifier. */
  get(key: string): SpanHandle | undefined
  /** Remove a span handle. */
  delete(key: string): void
  /** Clear all entries. */
  clear(): void
}

/**
 * Create an active span map for tracking in-flight spans.
 *
 * @returns An `ActiveSpanMap` backed by a simple Map.
 */
export function createActiveSpanMap(): ActiveSpanMap {
  const map = new Map<string, SpanHandle>()

  return {
    set(key, span) {
      map.set(key, span)
    },
    get(key) {
      return map.get(key)
    },
    delete(key) {
      map.delete(key)
    },
    clear() {
      map.clear()
    },
  }
}
